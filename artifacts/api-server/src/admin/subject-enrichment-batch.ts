import { createHash } from "node:crypto";

import type { Product } from "@workspace/db";

import type { SubjectEnrichmentStore } from "../domain/subject-enrichment-store";
import {
  getValidSubjectSummary,
  SUBJECT_SUMMARY_MODEL,
  SUBJECT_SUMMARY_PROMPT_VERSION,
  subjectSourceHash,
} from "../domain/subject-summary";

export const MAX_BATCH_SIZE = 50;
export const MAX_CONCURRENCY = 4;

export interface BatchOptions {
  limit: number;
  concurrency: number;
  force: boolean;
  retryFailed: boolean;
  dryRun: boolean;
  bookId?: string;
}

export interface BatchReport {
  catalog: number;
  sampled: number;
  selected: number;
  eligible: number;
  ready: number;
  stale: number;
  failed: number;
  generating: number;
  success: number;
  skipped: number;
  failures: number;
  calls: number;
  infrastructureErrors: number;
  durationMs: number;
  model: string;
  promptVersion: string;
}

export type SummaryGenerator = (
  product: Product,
  options?: {
    onCall?: () => void;
    onError?: (category: string) => void;
  },
) => Promise<{ summary: string } | null>;

function stableScore(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isDesignatedTitle(title: string): boolean {
  return /^(?:the gator samaritan|dear dad)(?:\s*\(|$)/i.test(title);
}

function hasSensitiveSubject(product: Product): boolean {
  return /\b(?:death|grief|abuse|violence|war|racism|slavery|illness|divorce|trauma)\b/i.test(
    product.subjects.join(" "),
  );
}

function strata(product: Product): string[] {
  const values = [
    ...product.subjects.map(
      (subject) => `subject:${subject.split(">")[0]?.trim().toLowerCase()}`,
    ),
    `form:${product.formatLabel.trim().toLowerCase() || "missing"}`,
    product.description.trim()
      ? product.description.length > 800
        ? "description:long"
        : "description:present"
      : "description:missing",
    product.publisher ? "publisher:present" : "publisher:missing",
    product.seriesName ? "series:present" : "series:missing",
  ];
  if (hasSensitiveSubject(product)) values.push("subject:sensitive");
  return values;
}

/**
 * Selects from the whole catalog before any cache eligibility check. The
 * deterministic greedy stratum coverage and hash order make every rerun target
 * the same experiment cohort instead of walking onward through the catalog.
 */
export function stableRepresentativeSample(
  products: Product[],
  limit = MAX_BATCH_SIZE,
): Product[] {
  const cap = Math.min(Math.max(limit, 0), MAX_BATCH_SIZE);
  const ordered = [...products].sort((a, b) => {
    const preferredA = isDesignatedTitle(a.title) ? 0 : 1;
    const preferredB = isDesignatedTitle(b.title) ? 0 : 1;
    return (
      preferredA - preferredB ||
      stableScore(a.id).localeCompare(stableScore(b.id)) ||
      a.id.localeCompare(b.id)
    );
  });
  const chosen: Product[] = [];
  const covered = new Set<string>();
  const remaining = new Set(ordered.map((product) => product.id));

  for (const product of ordered) {
    if (
      chosen.length < cap &&
      isDesignatedTitle(product.title)
    ) {
      chosen.push(product);
      remaining.delete(product.id);
      for (const value of strata(product)) covered.add(value);
    }
  }

  while (chosen.length < cap && remaining.size > 0) {
    let best: Product | undefined;
    let bestGain = -1;
    for (const product of ordered) {
      if (!remaining.has(product.id)) continue;
      const gain = strata(product).filter((value) => !covered.has(value)).length;
      if (gain > bestGain) {
        best = product;
        bestGain = gain;
      }
    }
    if (!best) break;
    chosen.push(best);
    remaining.delete(best.id);
    for (const value of strata(best)) covered.add(value);
  }
  return chosen;
}

function statusOf(product: Product): "ready" | "stale" | "failed" | "generating" | "absent" {
  if (getValidSubjectSummary(product, product) !== null) return "ready";
  if (product.subjectSummaryStatus === "failed") {
    return product.subjectSummarySourceHash === subjectSourceHash(product) &&
      product.subjectSummaryPromptVersion === SUBJECT_SUMMARY_PROMPT_VERSION
      ? "failed"
      : "stale";
  }
  if (product.subjectSummaryStatus === "generating") {
    return product.subjectSummaryAttemptedAt &&
      Date.now() - product.subjectSummaryAttemptedAt.getTime() < 10 * 60 * 1_000
      ? "generating"
      : "stale";
  }
  if (product.subjectSummaryStatus === "ready") return "stale";
  return "absent";
}

function isEligible(product: Product, options: BatchOptions): boolean {
  const status = statusOf(product);
  if (options.force) return status !== "generating";
  if (status === "ready" || status === "generating") return false;
  if (status === "failed") return options.retryFailed;
  return true;
}

export async function runSubjectEnrichmentBatch(input: {
  store: SubjectEnrichmentStore;
  generate: SummaryGenerator;
  options: BatchOptions;
}): Promise<BatchReport> {
  const started = Date.now();
  const products = await input.store.listProducts();
  const sample50 = stableRepresentativeSample(products, MAX_BATCH_SIZE);
  let selected = sample50.slice(0, input.options.limit);
  if (input.options.bookId) {
    const explicit = sample50.find((item) => item.id === input.options.bookId);
    if (!explicit) {
      throw new Error(
        `--book-id must identify a book in the stable ${MAX_BATCH_SIZE}-book sample`,
      );
    }
    selected = [explicit];
  }

  const statuses = selected.map(statusOf);
  const eligible = selected.filter((product) =>
    isEligible(product, input.options),
  );
  const report: BatchReport = {
    catalog: products.length,
    sampled: sample50.length,
    selected: selected.length,
    eligible: eligible.length,
    ready: statuses.filter((status) => status === "ready").length,
    stale: statuses.filter((status) => status === "stale").length,
    failed: statuses.filter((status) => status === "failed").length,
    generating: statuses.filter((status) => status === "generating").length,
    success: 0,
    skipped: selected.length - eligible.length,
    failures: 0,
    calls: 0,
    infrastructureErrors: 0,
    durationMs: 0,
    model: SUBJECT_SUMMARY_MODEL,
    promptVersion: SUBJECT_SUMMARY_PROMPT_VERSION,
  };
  if (input.options.dryRun) {
    report.durationMs = Date.now() - started;
    return report;
  }

  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < eligible.length) {
      const product = eligible[cursor++];
      const hash = subjectSourceHash(product);
      try {
        const claim = await input.store.claim({
          product,
          sourceHash: hash,
          force: input.options.force,
          retryFailed: input.options.retryFailed,
        });
        if (!claim.claimed) {
          report.skipped += 1;
          continue;
        }
        let error: string | null = null;
        const generated = await input.generate(claim.product, {
          onCall: () => {
            report.calls += 1;
          },
          onError: (category) => {
            error = category;
          },
        });
        const completion = await input.store.complete({
          productId: product.id,
          attemptId: claim.attemptId,
          sourceHash: hash,
          summary: generated?.summary ?? null,
          error,
        });
        if (!completion.committed) {
          report.skipped += 1;
        } else if (generated) {
          report.success += 1;
        } else {
          report.failures += 1;
        }
      } catch {
        report.infrastructureErrors += 1;
        report.failures += 1;
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(input.options.concurrency, eligible.length) },
      worker,
    ),
  );
  report.durationMs = Date.now() - started;
  return report;
}

export function parseBatchOptions(args: string[]): BatchOptions & {
  exportPath?: string;
  exportOnly: boolean;
} {
  const options: BatchOptions & { exportPath?: string; exportOnly: boolean } = {
    limit: 50,
    concurrency: 3,
    force: false,
    retryFailed: false,
    dryRun: false,
    exportOnly: false,
  };
  if (args[0] === "--") args = args.slice(1);
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];
    if (flag === "--limit" || flag === "--concurrency" || flag === "--book-id" || flag === "--export") {
      if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
      index += 1;
      if (flag === "--limit") options.limit = Number(value);
      if (flag === "--concurrency") options.concurrency = Number(value);
      if (flag === "--book-id") options.bookId = value;
      if (flag === "--export") options.exportPath = value;
    } else if (flag === "--force") options.force = true;
    else if (flag === "--retry-failed") options.retryFailed = true;
    else if (flag === "--dry-run") options.dryRun = true;
    else if (flag === "--export-only") options.exportOnly = true;
    else throw new Error(`Unknown option: ${flag}`);
  }
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > MAX_BATCH_SIZE) {
    throw new Error(`--limit must be an integer from 1 to ${MAX_BATCH_SIZE}`);
  }
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > MAX_CONCURRENCY) {
    throw new Error(`--concurrency must be an integer from 1 to ${MAX_CONCURRENCY}`);
  }
  if (options.exportOnly && !options.exportPath) {
    throw new Error("--export-only requires --export PATH");
  }
  return options;
}