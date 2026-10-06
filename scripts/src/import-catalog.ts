/**
 * Imports the HDS kids book catalog XML feed into Postgres.
 *
 * Run with: pnpm --filter @workspace/scripts run import-catalog
 *
 * The importer is idempotent: it clears the products table and re-inserts
 * everything, recording an import run plus a row per rejected record so the
 * demo can always account for the difference between the feed's declared
 * count and what is actually shoppable.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  productsTable,
  importRunsTable,
  rejectedRecordsTable,
  type InsertProduct,
  type Edition,
} from "@workspace/db/schema";

const SOURCE_FILE = "data/2026.08.14_Books_kids-grade_5-6_1787316321677.xml";

/**
 * Tags in the feed mix editorial signals with internal merchandising workflow
 * state. Anything matching these never reaches a customer-facing surface.
 */
const INTERNAL_TAG_PATTERNS = [
  /vertical placement/i,
  /completed/i,
  /^-+$/,
  /^\s*$/,
];

/** Binding field families present in the feed. BoardBooks is always empty but handled anyway. */
const BINDING_FAMILIES = [
  { prefix: "Hardcover", label: "Hardcover" },
  { prefix: "Paperback", label: "Paperback" },
  { prefix: "LibraryBinding", label: "Library Binding" },
  { prefix: "BoardBooks", label: "Board Book" },
] as const;

type RawBook = Record<string, unknown>;

function str(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function num(value: unknown): number | null {
  const raw = str(value);
  if (!raw) return null;
  const parsed = Number(raw.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function splitLines(value: unknown): string[] {
  return str(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function buildEditions(book: RawBook): Edition[] {
  const editions: Edition[] = [];

  for (const family of BINDING_FAMILIES) {
    const price = num(book[`${family.prefix}Price`]);
    const isbn = str(book[`${family.prefix}ISBN`]) || null;

    // A binding only exists for this title if it carries a price.
    if (price === null) continue;

    const quantity = num(book[`${family.prefix}Quantity`]);
    const bindingLabel = str(book[`${family.prefix}Binding`]) || family.label;

    editions.push({
      binding: bindingLabel,
      isbn,
      price,
      publisher: extractBindingScopedValue(book["Publisher"], family.label),
      // Quantity is either a positive number or absent in this feed; it is
      // never zero. Absent means unknown, which we must not present as stock.
      available: quantity !== null && quantity > 0,
    });
  }

  return editions;
}

/**
 * Publisher and MSRP arrive as binding-prefixed strings such as
 * "Hardcover: Papercutz" or "Hardcover: 9.99\nPaperback: 7.99".
 */
function extractBindingScopedValue(
  value: unknown,
  bindingLabel: string,
): string | null {
  const lines = splitLines(value);
  if (lines.length === 0) return null;

  for (const line of lines) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const prefix = line.slice(0, separator).trim();
    if (prefix.toLowerCase() === bindingLabel.toLowerCase()) {
      return line.slice(separator + 1).trim() || null;
    }
  }

  // Single unlabelled value applies to the whole record.
  if (lines.length === 1 && !lines[0].includes(":")) return lines[0];
  return null;
}

function cleanTags(value: unknown): string[] {
  return splitLines(value).filter(
    (tag) => !INTERNAL_TAG_PATTERNS.some((pattern) => pattern.test(tag)),
  );
}

function parseYear(publicationDate: string): number | null {
  const match = publicationDate.match(/(\d{4})/);
  return match ? Number(match[1]) : null;
}

async function main() {
  const root = path.resolve(import.meta.dirname, "..", "..");
  const xmlPath = path.join(root, SOURCE_FILE);

  console.log(`Reading ${SOURCE_FILE}`);
  const xml = readFileSync(xmlPath, "utf-8");

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    // Keep everything as strings so ISBNs never lose leading digits to Number().
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
  });

  const parsed = parser.parse(xml) as {
    Books: { "@_count"?: string; Book: RawBook[] };
  };

  const declaredCount = num(parsed.Books["@_count"]);
  const books = Array.isArray(parsed.Books.Book)
    ? parsed.Books.Book
    : [parsed.Books.Book];

  console.log(`Declared ${declaredCount} records, parsed ${books.length}`);

  const [importRun] = await db
    .insert(importRunsTable)
    .values({
      sourceFile: SOURCE_FILE,
      declaredCount,
      parsedCount: books.length,
    })
    .returning();

  const rows: InsertProduct[] = [];
  const rejected: { title: string | null; reason: string }[] = [];
  const usedIds = new Set<string>();

  for (const book of books) {
    const title = str(book["Title"]);

    if (!title) {
      rejected.push({ title: null, reason: "Missing title" });
      continue;
    }

    const editions = buildEditions(book);

    if (editions.length === 0) {
      rejected.push({ title, reason: "No priced edition in the feed" });
      continue;
    }

    // Card price and format follow the cheapest binding we can actually sell,
    // falling back to the cheapest priced binding when nothing is in stock.
    const inStock = editions.filter((edition) => edition.available);
    const pricingPool = inStock.length > 0 ? inStock : editions;
    const primary = pricingPool.reduce((cheapest, edition) =>
      (edition.price ?? Infinity) < (cheapest.price ?? Infinity)
        ? edition
        : cheapest,
    );

    const subjects = splitLines(book["Verticals"]);
    const topSubjects = [
      ...new Set(
        subjects
          .map((subject) => subject.split(">")[0]?.trim())
          .filter((subject): subject is string => Boolean(subject)),
      ),
    ];
    const tags = cleanTags(book["Tags"]);

    const author = str(book["Author"]);
    const seriesName = str(book["SeriesName"]) || null;
    const description = str(book["Description"]);
    const publicationDate = str(book["PublicationDate"]);

    let id = primary.isbn || `t-${slugify(title)}`;
    if (usedIds.has(id)) {
      id = `${id}-${usedIds.size}`;
    }
    usedIds.add(id);

    rows.push({
      id,
      title,
      author,
      illustrator: str(book["Illustrator"]) || null,
      seriesName,
      description,
      coverImageUrl: str(book["CoverImage"]) || null,
      readingLevel: str(book["ReadingLevel"]),
      publisher: primary.publisher,
      publicationDate: publicationDate || null,
      sourceUrl: str(book["BookDetailURL"]),
      price: primary.price,
      currency: "USD",
      formatLabel: primary.binding,
      availabilityLabel: primary.available ? "In stock" : null,
      editions,
      subjects,
      topSubjects,
      tags,
      bookScore: num(book["BookScore"]),
      awardCount: num(book["AwardCount"]) ?? 0,
      publicationYear: parseYear(publicationDate),
      searchText: [title, author, seriesName ?? "", description, ...subjects, ...tags]
        .join(" ")
        .toLowerCase(),
      rawSource: Object.fromEntries(
        Object.entries(book)
          .filter(([key]) => !key.startsWith("@_"))
          .map(([key, value]) => [key, str(value)]),
      ),
    });
  }

  console.log(`Normalized ${rows.length} products, rejected ${rejected.length}`);

  await db.delete(productsTable);

  const BATCH_SIZE = 200;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    await db.insert(productsTable).values(rows.slice(i, i + BATCH_SIZE));
  }

  if (rejected.length > 0) {
    await db.insert(rejectedRecordsTable).values(
      rejected.map((record) => ({
        importRunId: importRun.id,
        title: record.title,
        reason: record.reason,
      })),
    );
  }

  await db
    .update(importRunsTable)
    .set({
      importedCount: rows.length,
      rejectedCount: rejected.length,
      finishedAt: new Date(),
    })
    .where(eq(importRunsTable.id, importRun.id));

  const rejectionReasons = rejected.reduce<Record<string, number>>(
    (acc, record) => {
      acc[record.reason] = (acc[record.reason] ?? 0) + 1;
      return acc;
    },
    {},
  );

  console.log("Rejection breakdown:", rejectionReasons);
  console.log(
    `Covers missing: ${rows.filter((row) => !row.coverImageUrl).length}`,
  );
  console.log(
    `No availability claim: ${rows.filter((row) => !row.availabilityLabel).length}`,
  );
  console.log("Import complete.");

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
