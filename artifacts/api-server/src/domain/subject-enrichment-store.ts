import { randomUUID } from "node:crypto";

import { db, productsTable, type Product } from "@workspace/db";
import { eq } from "drizzle-orm";

import {
  getValidSubjectSummary,
  SUBJECT_SUMMARY_MODEL,
  SUBJECT_SUMMARY_PROMPT_VERSION,
  subjectSourceHash,
  validateSubjectSummary,
} from "./subject-summary";

export const SUBJECT_SUMMARY_LEASE_MS = 10 * 60 * 1_000;
const MAX_ERROR_LENGTH = 96;

export type ClaimResult =
  | { claimed: true; attemptId: string; product: Product }
  | { claimed: false; reason: "active" | "changed" | "failed" | "ready" };

export type CompletionResult =
  | { committed: true }
  | { committed: false; reason: "changed" | "expired" | "superseded" };

export interface ClaimOptions {
  product: Product;
  sourceHash: string;
  force: boolean;
  retryFailed: boolean;
  now?: Date;
  attemptId?: string;
}

export interface CompletionOptions {
  productId: string;
  attemptId: string;
  sourceHash: string;
  summary: string | null;
  error: string | null;
  now?: Date;
}

export interface SubjectEnrichmentStore {
  listProducts(): Promise<Product[]>;
  claim(options: ClaimOptions): Promise<ClaimResult>;
  complete(options: CompletionOptions): Promise<CompletionResult>;
}

const VALID_STATUSES = new Set([
  null,
  "pending",
  "generating",
  "ready",
  "failed",
]);

function assertValidStatus(product: Product): void {
  if (!VALID_STATUSES.has(product.subjectSummaryStatus)) {
    throw new Error(
      `Invalid subject summary status for product ${product.id}`,
    );
  }
}

function hasActiveLease(product: Product, now: Date): boolean {
  return (
    product.subjectSummaryStatus === "generating" &&
    product.subjectSummaryAttemptedAt !== null &&
    now.getTime() - product.subjectSummaryAttemptedAt.getTime() <
      SUBJECT_SUMMARY_LEASE_MS
  );
}

function boundedError(error: string | null): string {
  const safe = (error ?? "no_summary")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_")
    .slice(0, MAX_ERROR_LENGTH);
  return safe || "unknown";
}

/**
 * PostgreSQL-backed claim adapter. Both claim and completion lock one product
 * row, so independent CLI processes cannot call the model for the same lease.
 */
export class PostgresSubjectEnrichmentStore
  implements SubjectEnrichmentStore
{
  async listProducts(): Promise<Product[]> {
    const products = await db.select().from(productsTable);
    for (const product of products) assertValidStatus(product);
    return products;
  }

  async claim(options: ClaimOptions): Promise<ClaimResult> {
    const now = options.now ?? new Date();
    const attemptId = options.attemptId ?? randomUUID();

    return db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(productsTable)
        .where(eq(productsTable.id, options.product.id))
        .for("update");

      if (!current || subjectSourceHash(current) !== options.sourceHash) {
        return { claimed: false, reason: "changed" } as const;
      }
      assertValidStatus(current);
      if (hasActiveLease(current, now)) {
        return { claimed: false, reason: "active" } as const;
      }

      const currentReady =
        getValidSubjectSummary(current, current) !== null &&
        current.subjectSummaryModel === SUBJECT_SUMMARY_MODEL;
      if (currentReady && !options.force) {
        return { claimed: false, reason: "ready" } as const;
      }

      const failedForCurrentSource =
        current.subjectSummaryStatus === "failed" &&
        current.subjectSummarySourceHash === options.sourceHash &&
        current.subjectSummaryPromptVersion ===
          SUBJECT_SUMMARY_PROMPT_VERSION;
      if (failedForCurrentSource && !options.retryFailed && !options.force) {
        return { claimed: false, reason: "failed" } as const;
      }

      await tx
        .update(productsTable)
        .set({
          subjectSummary: null,
          subjectSummaryStatus: "generating",
          subjectSummaryModel: SUBJECT_SUMMARY_MODEL,
          subjectSummaryPromptVersion: SUBJECT_SUMMARY_PROMPT_VERSION,
          subjectSummarySourceHash: options.sourceHash,
          subjectSummaryGeneratedAt: null,
          subjectSummaryError: null,
          subjectSummaryAttemptId: attemptId,
          subjectSummaryAttemptedAt: now,
        })
        .where(eq(productsTable.id, current.id));

      return { claimed: true, attemptId, product: current } as const;
    });
  }

  async complete(options: CompletionOptions): Promise<CompletionResult> {
    const now = options.now ?? new Date();

    return db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(productsTable)
        .where(eq(productsTable.id, options.productId))
        .for("update");

      if (
        !current ||
        current.subjectSummaryAttemptId !== options.attemptId
      ) {
        return { committed: false, reason: "superseded" } as const;
      }
      assertValidStatus(current);
      if (current.subjectSummaryStatus !== "generating") {
        return { committed: false, reason: "superseded" } as const;
      }
      if (
        current.subjectSummaryAttemptedAt === null ||
        now.getTime() - current.subjectSummaryAttemptedAt.getTime() >=
          SUBJECT_SUMMARY_LEASE_MS
      ) {
        return { committed: false, reason: "expired" } as const;
      }
      if (
        current.subjectSummarySourceHash !== options.sourceHash ||
        subjectSourceHash(current) !== options.sourceHash
      ) {
        return { committed: false, reason: "changed" } as const;
      }

      const summary =
        options.summary !== null && validateSubjectSummary(options.summary)
          ? options.summary
          : null;
      const completionError =
        options.summary !== null && summary === null
          ? "invalid_summary"
          : options.error;
      await tx
        .update(productsTable)
        .set(
          summary
            ? {
                subjectSummary: summary,
                subjectSummaryStatus: "ready",
                subjectSummaryModel: SUBJECT_SUMMARY_MODEL,
                subjectSummaryPromptVersion:
                  SUBJECT_SUMMARY_PROMPT_VERSION,
                subjectSummarySourceHash: options.sourceHash,
                subjectSummaryGeneratedAt: now,
                subjectSummaryError: null,
                subjectSummaryAttemptId: null,
                subjectSummaryAttemptedAt: now,
              }
            : {
                subjectSummary: null,
                subjectSummaryStatus: "failed",
                subjectSummaryModel: SUBJECT_SUMMARY_MODEL,
                subjectSummaryPromptVersion:
                  SUBJECT_SUMMARY_PROMPT_VERSION,
                subjectSummarySourceHash: options.sourceHash,
                subjectSummaryGeneratedAt: null,
                subjectSummaryError: boundedError(completionError),
                subjectSummaryAttemptId: null,
                subjectSummaryAttemptedAt: now,
              },
        )
        .where(eq(productsTable.id, current.id));

      return { committed: true } as const;
    });
  }
}