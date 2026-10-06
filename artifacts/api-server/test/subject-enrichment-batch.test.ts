import assert from "node:assert/strict";
import test from "node:test";

import type { Product } from "@workspace/db";

import {
  parseBatchOptions,
  runSubjectEnrichmentBatch,
  stableRepresentativeSample,
} from "../src/admin/subject-enrichment-batch";
import type {
  ClaimOptions,
  CompletionOptions,
  SubjectEnrichmentStore,
} from "../src/domain/subject-enrichment-store";
import {
  SUBJECT_SUMMARY_MODEL,
  SUBJECT_SUMMARY_PROMPT_VERSION,
  subjectSourceHash,
} from "../src/domain/subject-summary";

function product(id: string, overrides: Partial<Product> = {}): Product {
  return {
    id,
    title: `Book ${id}`,
    author: "",
    illustrator: null,
    seriesName: null,
    description: "A catalog description.",
    coverImageUrl: null,
    readingLevel: "Grade 3",
    publisher: "Publisher",
    publicationDate: null,
    sourceUrl: "",
    price: null,
    currency: "USD",
    formatLabel: "Hardcover",
    availabilityLabel: null,
    editions: [],
    subjects: ["Juvenile Fiction > Animals"],
    topSubjects: ["Juvenile Fiction"],
    tags: [],
    subjectSummary: null,
    subjectSummaryStatus: null,
    subjectSummaryModel: null,
    subjectSummaryPromptVersion: null,
    subjectSummarySourceHash: null,
    subjectSummaryGeneratedAt: null,
    subjectSummaryError: null,
    subjectSummaryAttemptId: null,
    subjectSummaryAttemptedAt: null,
    bookScore: null,
    awardCount: 0,
    publicationYear: null,
    searchText: "",
    rawSource: null,
    ...overrides,
  };
}

class FakeStore implements SubjectEnrichmentStore {
  claims = 0;
  completions = 0;
  active = 0;
  peak = 0;

  constructor(readonly products: Product[]) {}

  async listProducts(): Promise<Product[]> {
    return this.products;
  }

  async claim(options: ClaimOptions) {
    this.claims += 1;
    return {
      claimed: true as const,
      attemptId: `attempt-${options.product.id}`,
      product: options.product,
    };
  }

  async complete(_options: CompletionOptions) {
    this.completions += 1;
    return { committed: true as const };
  }
}

test("validates bounded CLI options", () => {
  assert.deepEqual(parseBatchOptions([]), {
    limit: 50,
    concurrency: 3,
    force: false,
    retryFailed: false,
    dryRun: false,
    exportOnly: false,
  });
  assert.throws(() => parseBatchOptions(["--limit", "51"]), /1 to 50/);
  assert.throws(() => parseBatchOptions(["--concurrency", "5"]), /1 to 4/);
  assert.throws(() => parseBatchOptions(["--unknown"]), /Unknown option/);
  assert.throws(() => parseBatchOptions(["--export-only"]), /requires --export/);
  assert.deepEqual(parseBatchOptions(["--", "--limit", "12"]), {
    limit: 12,
    concurrency: 3,
    force: false,
    retryFailed: false,
    dryRun: false,
    exportOnly: false,
  });
});

test("stable sample is reproducible and includes designated books", () => {
  const products = Array.from({ length: 80 }, (_, index) =>
    product(String(index)),
  );
  products[70] = product("gator", {
    title:
      "The Gator Samaritan (Geronimo Stilton Reporter Graphic Novels #22)",
  });
  products[71] = product("dad", { title: "Dear Dad" });
  const first = stableRepresentativeSample(products).map(({ id }) => id);
  const reversed = stableRepresentativeSample([...products].reverse()).map(
    ({ id }) => id,
  );
  assert.deepEqual(first, reversed);
  assert.equal(first.length, 50);
  assert.ok(first.includes("gator"));
  assert.ok(first.includes("dad"));
});

test("dry-run performs no claims or model calls", async () => {
  const store = new FakeStore([product("one"), product("two")]);
  let calls = 0;
  const report = await runSubjectEnrichmentBatch({
    store,
    generate: async () => {
      calls += 1;
      return { summary: "Animals and friendship shape this gentle story." };
    },
    options: {
      limit: 2,
      concurrency: 3,
      force: false,
      retryFailed: false,
      dryRun: true,
    },
  });
  assert.equal(report.eligible, 2);
  assert.equal(store.claims, 0);
  assert.equal(store.completions, 0);
  assert.equal(calls, 0);
});

test("reuses ready cache and requires retry-failed", async () => {
  const ready = product("ready");
  ready.subjectSummary = "Animals and friendship shape this gentle story.";
  ready.subjectSummaryStatus = "ready";
  ready.subjectSummaryModel = SUBJECT_SUMMARY_MODEL;
  ready.subjectSummaryPromptVersion = SUBJECT_SUMMARY_PROMPT_VERSION;
  ready.subjectSummarySourceHash = subjectSourceHash(ready);
  const failed = product("failed", {
    subjectSummaryStatus: "failed",
    subjectSummaryPromptVersion: SUBJECT_SUMMARY_PROMPT_VERSION,
  });
  failed.subjectSummarySourceHash = subjectSourceHash(failed);
  const store = new FakeStore([ready, failed]);
  const generate = async (
    _product: Product,
    options?: { onCall?: () => void },
  ) => {
    options?.onCall?.();
    return { summary: "Animals and friendship shape this gentle story." };
  };

  const base = {
    limit: 2,
    concurrency: 1,
    force: false,
    retryFailed: false,
    dryRun: false,
  };
  const first = await runSubjectEnrichmentBatch({ store, generate, options: base });
  assert.equal(first.eligible, 0);
  const retry = await runSubjectEnrichmentBatch({
    store,
    generate,
    options: { ...base, retryFailed: true },
  });
  assert.equal(retry.eligible, 1);
  assert.equal(retry.calls, 1);
  const force = await runSubjectEnrichmentBatch({
    store,
    generate,
    options: { ...base, force: true },
  });
  assert.equal(force.eligible, 2);
});

test("worker pool obeys concurrency bound and calls once per claim", async () => {
  const store = new FakeStore(
    Array.from({ length: 8 }, (_, index) => product(String(index))),
  );
  const generate = async (
    _product: Product,
    options?: { onCall?: () => void },
  ) => {
    options?.onCall?.();
    store.active += 1;
    store.peak = Math.max(store.peak, store.active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    store.active -= 1;
    return { summary: "Animals and friendship shape this gentle story." };
  };
  const report = await runSubjectEnrichmentBatch({
    store,
    generate,
    options: {
      limit: 8,
      concurrency: 2,
      force: false,
      retryFailed: false,
      dryRun: false,
    },
  });
  assert.equal(report.calls, 8);
  assert.equal(store.completions, 8);
  assert.ok(store.peak <= 2);
});

test("book-id cannot bypass the stable experiment cohort", async () => {
  const products = Array.from({ length: 60 }, (_, index) =>
    product(String(index)),
  );
  const sampleIds = new Set(stableRepresentativeSample(products).map(({ id }) => id));
  const outside = products.find(({ id }) => !sampleIds.has(id));
  assert.ok(outside);
  await assert.rejects(
    runSubjectEnrichmentBatch({
      store: new FakeStore(products),
      generate: async () => null,
      options: {
        limit: 50,
        concurrency: 1,
        force: false,
        retryFailed: false,
        dryRun: true,
        bookId: outside.id,
      },
    }),
    /stable 50-book sample/,
  );
});