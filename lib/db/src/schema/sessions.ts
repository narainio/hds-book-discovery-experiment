import {
  pgTable,
  text,
  integer,
  timestamp,
  primaryKey,
  serial,
  jsonb,
} from "drizzle-orm/pg-core";

/**
 * The structured reading of a free-text query. Cached on the session so the
 * optional language model is called once when the query is set, never during
 * ranking or paging.
 */
export type StoredInterpretation = {
  themes: string[];
  formats: string[];
  reduce: string[];
  terms: string[];
  seriesHint: string | null;
  source: string;
};

/**
 * An anonymous prototype session. No accounts exist; the client holds only
 * the id. Everything that shapes ranking hangs off this row.
 */
export const sessionsTable = pgTable("sessions", {
  id: text("id").primaryKey(),
  modeId: text("mode_id").notNull().default("johnny"),
  /** Active natural-language direction, or null. */
  query: text("query"),
  /** Set when the query came from a curated prompt rather than free text. */
  queryPromptId: text("query_prompt_id"),
  querySource: text("query_source"),
  /** Cached interpretation of `query`; null until a query is set. */
  queryInterpretation: jsonb(
    "query_interpretation",
  ).$type<StoredInterpretation>(),
  /** The single active "more like this" pivot. Replacing it replaces the old one. */
  pivotBookId: text("pivot_book_id"),
  /** Bumped on every signal change so the client can detect a re-rank. */
  rankingVersion: integer("ranking_version").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * Johnny's Picks. A discovery signal collection - explicitly NOT the cart,
 * and removing a row here is NOT negative feedback.
 */
export const picksTable = pgTable(
  "picks",
  {
    sessionId: text("session_id").notNull(),
    bookId: text("book_id").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.sessionId, table.bookId] })],
);

/** Explicit "show me fewer books like this" signals. */
export const negativeSignalsTable = pgTable(
  "negative_signals",
  {
    sessionId: text("session_id").notNull(),
    bookId: text("book_id").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.sessionId, table.bookId] })],
);

/** Purchase intent. Separate from Picks in state, labels and treatment. */
export const cartItemsTable = pgTable(
  "cart_items",
  {
    sessionId: text("session_id").notNull(),
    bookId: text("book_id").notNull(),
    quantity: integer("quantity").notNull().default(1),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.sessionId, table.bookId] })],
);

export const interactionsTable = pgTable("interactions", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  name: text("name").notNull(),
  bookId: text("book_id"),
  query: text("query"),
  source: text("source"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Session = typeof sessionsTable.$inferSelect;
export type Pick = typeof picksTable.$inferSelect;
export type NegativeSignal = typeof negativeSignalsTable.$inferSelect;
export type CartItem = typeof cartItemsTable.$inferSelect;
export type Interaction = typeof interactionsTable.$inferSelect;
