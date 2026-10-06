import {
  pgTable,
  text,
  integer,
  doublePrecision,
  jsonb,
  index,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * A binding-specific edition of a title (hardcover, paperback, library binding).
 * Prices and ISBNs in the source feed are per-binding, so a single catalog
 * record can carry several of these.
 */
export type Edition = {
  binding: string;
  isbn: string | null;
  price: number | null;
  publisher: string | null;
  available: boolean;
};

export const productsTable = pgTable(
  "products",
  {
    /** Stable id derived from the cheapest edition's ISBN, or a title slug fallback. */
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    author: text("author").notNull().default(""),
    illustrator: text("illustrator"),
    seriesName: text("series_name"),
    description: text("description").notNull().default(""),
    coverImageUrl: text("cover_image_url"),
    /** The feed's ReadingLevel string. Constant across the whole catalog. */
    readingLevel: text("reading_level").notNull().default(""),
    publisher: text("publisher"),
    publicationDate: text("publication_date"),
    sourceUrl: text("source_url").notNull().default(""),

    /** Cheapest available binding, surfaced on cards. */
    price: doublePrecision("price"),
    currency: text("currency").notNull().default("USD"),
    formatLabel: text("format_label").notNull().default(""),
    /** Null when the feed gives no stock signal - render no availability claim. */
    availabilityLabel: text("availability_label"),
    editions: jsonb("editions").$type<Edition[]>().notNull().default([]),

    /** Full hierarchical subject paths, e.g. "Fantasy & SF > Magic". */
    subjects: jsonb("subjects").$type<string[]>().notNull().default([]),
    /** First segment of each subject path, deduped. Used for diversification. */
    topSubjects: jsonb("top_subjects").$type<string[]>().notNull().default([]),
    /** Editorially useful tags only. Internal workflow tags are dropped at import. */
    tags: jsonb("tags").$type<string[]>().notNull().default([]),

    /** Optional HDS interpretation only; never used in search or ranking. */
    subjectSummary: text("subject_summary"),
    subjectSummaryStatus: text("subject_summary_status").$type<
      "pending" | "generating" | "ready" | "failed"
    >(),
    subjectSummaryModel: text("subject_summary_model"),
    subjectSummaryPromptVersion: text("subject_summary_prompt_version"),
    subjectSummarySourceHash: text("subject_summary_source_hash"),
    subjectSummaryGeneratedAt: timestamp("subject_summary_generated_at", { withTimezone: true }),
    subjectSummaryError: text("subject_summary_error"),
    subjectSummaryAttemptId: text("subject_summary_attempt_id"),
    subjectSummaryAttemptedAt: timestamp("subject_summary_attempted_at", { withTimezone: true }),

    bookScore: doublePrecision("book_score"),
    awardCount: integer("award_count").notNull().default(0),
    publicationYear: integer("publication_year"),

    /** Lowercased title + author + series + description + subjects + tags, for lexical scoring. */
    searchText: text("search_text").notNull().default(""),
    /** Untouched source record, so the PDP can never be accused of inventing a field. */
    rawSource: jsonb("raw_source").$type<Record<string, string>>(),
  },
  (table) => [
    index("products_title_idx").on(table.title),
    index("products_series_idx").on(table.seriesName),
  ],
);

export type Product = typeof productsTable.$inferSelect;
export type InsertProduct = typeof productsTable.$inferInsert;
