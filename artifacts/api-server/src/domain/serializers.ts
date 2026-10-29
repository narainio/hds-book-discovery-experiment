/**
 * Maps catalog rows onto the shapes described in the OpenAPI contract.
 *
 * Nothing here invents a value. Where the feed is silent - a missing cover, an
 * unknown stock level - the serializer emits null so the UI can decline to make
 * a claim rather than guessing.
 */
import type { Product } from "@workspace/db";
import { discountedPrice } from "@workspace/pricing";
import { buildDisplayTopics } from "./subject-normalizer";

export { discountedPrice } from "@workspace/pricing";

export type BookSummaryDto = {
  id: string;
  title: string;
  author: string;
  seriesName: string | null;
  coverImageUrl: string | null;
  hasCover: boolean;
  price: number | null;
  catalogPrice: number | null;
  currency: string;
  formatLabel: string;
  publicationYear?: number | null;
};

export type BookThumbDto = {
  id: string;
  title: string;
  coverImageUrl: string | null;
  publicationYear?: number | null;
};

export function toBookSummary(product: Product): BookSummaryDto {
  return {
    id: product.id,
    title: product.title,
    author: product.author,
    seriesName: product.seriesName,
    coverImageUrl: product.coverImageUrl,
    hasCover: Boolean(product.coverImageUrl),
    price: discountedPrice(product.price),
    catalogPrice: product.price,
    currency: product.currency,
    formatLabel: product.formatLabel,
    publicationYear: product.publicationYear,
  };
}

export function toBookThumb(product: Product): BookThumbDto {
  return {
    id: product.id,
    title: product.title,
    coverImageUrl: product.coverImageUrl,
    publicationYear: product.publicationYear,
  };
}

/**
 * Feed titles carry a trailing series parenthetical, e.g.
 * "The Gator Samaritan (Geronimo Stilton Reporter Graphic Novels #22)".
 * Explanations and the shaping summary must stay to one short line, so they
 * use the title without it.
 */
export function shortTitle(title: string): string {
  const stripped = title.replace(/\s*\([^()]*\)\s*$/, "").trim();
  return stripped.length > 0 ? stripped : title;
}

/** Human labels for the format tags we surface in the PDP summary. */
const FORMAT_PHRASES: Record<string, string> = {
  "Graphic Novel": "graphic novel",
  "Chapter Book": "chapter book",
  "Picture Book": "picture book",
  "Illustrated Novel": "illustrated novel",
  "Novel in Verse": "novel in verse",
};

/**
 * Assembles "Why it may suit Johnny" strictly from catalog fields. Returns null
 * when the record carries nothing substantive, because an empty section is
 * more honest than a padded one.
 */
export function buildWhyItMaySuit(product: Product): string | null {
  const clauses: string[] = [];

  const formatTag = Object.keys(FORMAT_PHRASES).find((tag) =>
    product.tags.includes(tag),
  );
  const subjects = product.topSubjects.slice(0, 2).map((s) => s.toLowerCase());

  if (formatTag && subjects.length > 0) {
    clauses.push(
      `A ${FORMAT_PHRASES[formatTag]} in ${formatList(subjects)}.`,
    );
  } else if (formatTag) {
    clauses.push(`A ${FORMAT_PHRASES[formatTag]}.`);
  } else if (subjects.length > 0) {
    clauses.push(`Covers ${formatList(subjects)}.`);
  }

  if (product.seriesName) {
    clauses.push(`Part of the ${product.seriesName} series.`);
  }

  if (product.tags.includes("Hi-Lo")) {
    clauses.push("Written to be approachable for developing readers.");
  }

  if (product.tags.includes("Includes Illustrations") && formatTag !== "Graphic Novel") {
    clauses.push("Includes illustrations throughout.");
  }

  if (product.readingLevel) {
    clauses.push(`Listed by the publisher at ${normalizeReadingLevel(product.readingLevel)}.`);
  }

  return clauses.length > 0 ? clauses.join(" ") : null;
}

/** The feed uses a Unicode minus sign in its reading level string. */
function normalizeReadingLevel(readingLevel: string): string {
  return readingLevel.replace(/\u2212/g, "\u2013").trim();
}

function formatList(items: string[]): string {
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function toBookDetail(product: Product, subjectSummary: string | null = null) {
  return {
    id: product.id,
    title: product.title,
    author: product.author,
    illustrator: product.illustrator,
    seriesName: product.seriesName,
    description: product.description,
    coverImageUrl: product.coverImageUrl,
    hasCover: Boolean(product.coverImageUrl),
    price: discountedPrice(product.price),
    catalogPrice: product.price,
    currency: product.currency,
    formatLabel: product.formatLabel,
    readingLevel: normalizeReadingLevel(product.readingLevel),
    publisher: product.publisher,
    publicationDate: product.publicationDate,
    availabilityLabel: product.availabilityLabel,
    subjects: product.subjects,
    displayTopics: buildDisplayTopics(product),
    subjectSummary,
    tags: product.tags,
    editions: product.editions.map((edition) => ({
      ...edition,
      catalogPrice: edition.price,
      price: discountedPrice(edition.price),
    })),
    sourceUrl: product.sourceUrl,
    whyItMaySuit: buildWhyItMaySuit(product),
  };
}
