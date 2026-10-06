/** Read-only optional enrichment. Never imports the generation service. */
import { db, productsTable, type Product } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { getValidSubjectSummary, subjectSourceHash } from "./subject-summary";

/** Also compare the live source with the catalog snapshot shown on the page:
 * an externally edited record must not mix new interpretation with old facts. */
export async function readSubjectSummary(product: Product): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const read = db.select({
      title: productsTable.title,
      description: productsTable.description,
      subjects: productsTable.subjects,
      tags: productsTable.tags,
      formatLabel: productsTable.formatLabel,
      readingLevel: productsTable.readingLevel,
      seriesName: productsTable.seriesName,
      subjectSummary: productsTable.subjectSummary,
      subjectSummaryStatus: productsTable.subjectSummaryStatus,
      subjectSummaryPromptVersion: productsTable.subjectSummaryPromptVersion,
      subjectSummarySourceHash: productsTable.subjectSummarySourceHash,
    }).from(productsTable).where(eq(productsTable.id, product.id)).limit(1);
    const rows = await Promise.race([
      read,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("cache_read_timeout")), 750);
      }),
    ]);
    const current = rows[0];
    if (!current || subjectSourceHash(current) !== subjectSourceHash(product)) return null;
    return getValidSubjectSummary(product, current);
  } catch {
    logger.warn({ category: "subject_cache_read_unavailable" }, "Serving deterministic Topics only");
    return null;
  } finally {
    clearTimeout(timer);
  }
}