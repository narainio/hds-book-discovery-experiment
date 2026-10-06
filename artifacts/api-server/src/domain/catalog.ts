/**
 * In-memory catalog and lexical similarity index.
 *
 * The whole catalog is ~2,400 records, so it is loaded once at boot and held in
 * memory. This is what lets "More like this" and Picks-driven reranking run
 * with no external service in the request path - a hard requirement for the
 * demo, which must work with no live language model.
 */
import { db, productsTable, type Product } from "@workspace/db";
import { STOPWORDS } from "./config";
import { logger } from "../lib/logger";

/** Field weights applied when building each product's term vector. */
const FIELD_WEIGHTS = {
  title: 3,
  series: 2,
  author: 2,
  subjects: 2,
  tags: 2,
  description: 1,
} as const;

export type IndexedProduct = Product & {
  /** L2-normalized TF-IDF vector over weighted fields. */
  vector: Map<string, number>;
  subjectSet: Set<string>;
  topSubjectSet: Set<string>;
  tagSet: Set<string>;
  /** Lowercased, for cheap substring matching in typeahead. */
  titleLower: string;
  authorLower: string;
  seriesLower: string;
  /**
   * Spanish-language editions stay in the catalog and remain findable by
   * search, but they should not occupy prime slots in a default English
   * browse for this mode.
   */
  isSpanishEdition: boolean;
};

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

function addTokens(
  counts: Map<string, number>,
  text: string,
  weight: number,
): void {
  for (const token of tokenize(text)) {
    counts.set(token, (counts.get(token) ?? 0) + weight);
  }
}

class Catalog {
  products: IndexedProduct[] = [];
  byId = new Map<string, IndexedProduct>();
  idf = new Map<string, number>();
  /** Distinct series names, for typeahead. */
  seriesIndex = new Map<string, { name: string; count: number }>();
  subjectIndex = new Map<string, { name: string; count: number }>();
  authorIndex = new Map<string, { name: string; count: number }>();
  loaded = false;

  async load(): Promise<void> {
    const rows = await db.select().from(productsTable);

    if (rows.length === 0) {
      logger.warn(
        "Catalog is empty. Run: pnpm --filter @workspace/scripts run import-catalog",
      );
    }

    // Pass 1: raw weighted term counts and document frequency.
    const rawCounts: Map<string, number>[] = [];
    const documentFrequency = new Map<string, number>();

    for (const row of rows) {
      const counts = new Map<string, number>();
      addTokens(counts, row.title, FIELD_WEIGHTS.title);
      addTokens(counts, row.seriesName ?? "", FIELD_WEIGHTS.series);
      addTokens(counts, row.author, FIELD_WEIGHTS.author);
      addTokens(counts, row.subjects.join(" "), FIELD_WEIGHTS.subjects);
      addTokens(counts, row.tags.join(" "), FIELD_WEIGHTS.tags);
      addTokens(counts, row.description, FIELD_WEIGHTS.description);

      rawCounts.push(counts);
      for (const term of counts.keys()) {
        documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
      }
    }

    const total = rows.length || 1;
    for (const [term, frequency] of documentFrequency) {
      this.idf.set(term, Math.log(1 + total / (1 + frequency)));
    }

    // Pass 2: TF-IDF with sublinear term frequency, then L2 normalize.
    this.products = rows.map((row, index) => {
      const counts = rawCounts[index];
      const vector = new Map<string, number>();
      let norm = 0;

      for (const [term, count] of counts) {
        const weight = (1 + Math.log(count)) * (this.idf.get(term) ?? 0);
        if (weight <= 0) continue;
        vector.set(term, weight);
        norm += weight * weight;
      }

      norm = Math.sqrt(norm) || 1;
      for (const [term, weight] of vector) {
        vector.set(term, weight / norm);
      }

      return {
        ...row,
        vector,
        subjectSet: new Set(row.subjects),
        topSubjectSet: new Set(row.topSubjects),
        tagSet: new Set(row.tags),
        titleLower: row.title.toLowerCase(),
        authorLower: row.author.toLowerCase(),
        seriesLower: (row.seriesName ?? "").toLowerCase(),
        isSpanishEdition: /spanish edition|edici\u00f3n en espa\u00f1ol/i.test(
          row.title,
        ),
      };
    });

    this.byId = new Map(this.products.map((product) => [product.id, product]));

    for (const product of this.products) {
      if (product.seriesName) {
        const entry = this.seriesIndex.get(product.seriesLower) ?? {
          name: product.seriesName,
          count: 0,
        };
        entry.count += 1;
        this.seriesIndex.set(product.seriesLower, entry);
      }

      if (product.author) {
        const key = product.authorLower;
        const entry = this.authorIndex.get(key) ?? {
          name: product.author,
          count: 0,
        };
        entry.count += 1;
        this.authorIndex.set(key, entry);
      }

      for (const subject of product.subjects) {
        // Index the leaf of each hierarchical path; it is what parents recognize.
        const leaf = subject.split(">").pop()?.trim();
        if (!leaf) continue;
        const entry = this.subjectIndex.get(leaf.toLowerCase()) ?? {
          name: leaf,
          count: 0,
        };
        entry.count += 1;
        this.subjectIndex.set(leaf.toLowerCase(), entry);
      }
    }

    this.loaded = true;
    logger.info(
      { products: this.products.length, terms: this.idf.size },
      "Catalog index built",
    );
  }

  get size(): number {
    return this.products.length;
  }

  /** Cosine similarity between two L2-normalized sparse vectors. */
  similarity(a: Map<string, number>, b: Map<string, number>): number {
    // Iterate the smaller vector for speed.
    const [small, large] = a.size <= b.size ? [a, b] : [b, a];
    let dot = 0;
    for (const [term, weight] of small) {
      const other = large.get(term);
      if (other !== undefined) dot += weight * other;
    }
    return dot;
  }

  /** Builds an L2-normalized vector from an arbitrary list of terms. */
  vectorFromTerms(terms: string[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const term of terms) {
      const normalized = term.toLowerCase();
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }

    const vector = new Map<string, number>();
    let norm = 0;
    for (const [term, count] of counts) {
      const weight = (1 + Math.log(count)) * (this.idf.get(term) ?? 0);
      if (weight <= 0) continue;
      vector.set(term, weight);
      norm += weight * weight;
    }

    norm = Math.sqrt(norm) || 1;
    for (const [term, weight] of vector) {
      vector.set(term, weight / norm);
    }
    return vector;
  }
}

export const catalog = new Catalog();
