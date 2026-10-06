import { pgTable, text, integer, timestamp, serial } from "drizzle-orm/pg-core";

/** One row per catalog import, so the demo can prove where the data came from. */
export const importRunsTable = pgTable("import_runs", {
  id: serial("id").primaryKey(),
  sourceFile: text("source_file").notNull(),
  declaredCount: integer("declared_count"),
  parsedCount: integer("parsed_count").notNull().default(0),
  importedCount: integer("imported_count").notNull().default(0),
  rejectedCount: integer("rejected_count").notNull().default(0),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  finishedAt: timestamp("finished_at"),
});

/** Records deliberately excluded at import, with the reason. */
export const rejectedRecordsTable = pgTable("rejected_records", {
  id: serial("id").primaryKey(),
  importRunId: integer("import_run_id").notNull(),
  title: text("title"),
  reason: text("reason").notNull(),
});

export type ImportRun = typeof importRunsTable.$inferSelect;
export type RejectedRecord = typeof rejectedRecordsTable.$inferSelect;
