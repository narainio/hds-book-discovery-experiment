import { basename, resolve, sep } from "node:path";

import {
  PostgresSubjectEnrichmentStore,
} from "../domain/subject-enrichment-store";
import { generateSubjectSummary } from "../domain/subject-enrichment";
import {
  parseBatchOptions,
  runSubjectEnrichmentBatch,
  stableRepresentativeSample,
} from "./subject-enrichment-batch";
import { exportSubjectReview } from "./subject-review-export";

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Subject enrichment CLI is local-only and refuses production");
  }
  const options = parseBatchOptions(process.argv.slice(2));
  const store = new PostgresSubjectEnrichmentStore();

  let report:
    | Awaited<ReturnType<typeof runSubjectEnrichmentBatch>>
    | undefined;
  if (!options.exportOnly) {
    report = await runSubjectEnrichmentBatch({
      store,
      generate: generateSubjectSummary,
      options,
    });
  }
  // Dry-run is a strict no-write mode, including review artifacts.
  if (options.exportPath && !options.dryRun) {
    const reviewRoot = resolve(process.cwd(), "../../artifacts/review");
    const requested = options.exportPath.includes("artifacts/review")
      ? resolve(process.cwd(), "../..", options.exportPath)
      : resolve(reviewRoot, basename(options.exportPath));
    if (
      requested !== reviewRoot &&
      !requested.startsWith(`${reviewRoot}${sep}`)
    ) {
      throw new Error("--export must write under artifacts/review");
    }
    const sample50 = stableRepresentativeSample(await store.listProducts(), 50);
    const products = options.bookId
      ? sample50.filter((product) => product.id === options.bookId)
      : sample50.slice(0, options.limit);
    await exportSubjectReview(requested, products);
  }
  if (report) {
    // Aggregate operational metadata only: no provider payload or catalog prose.
    console.log(JSON.stringify(report));
    if (report.infrastructureErrors > 0) process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      error: error instanceof Error ? error.message : "Unknown infrastructure error",
    }),
  );
  process.exitCode = 1;
});