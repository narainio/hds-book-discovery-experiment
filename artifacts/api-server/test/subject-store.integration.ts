import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

if (process.env.NODE_ENV === "production") {
  throw new Error("Subject store integration tests refuse production");
}

const { db, productsTable } = await import("@workspace/db");
const { eq, sql } = await import("drizzle-orm");
const {
  PostgresSubjectEnrichmentStore,
  SUBJECT_SUMMARY_LEASE_MS,
} = await import("../src/domain/subject-enrichment-store");
const { subjectSourceHash } = await import("../src/domain/subject-summary");

const store = new PostgresSubjectEnrichmentStore();
const apiPackageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reviewRoot = resolve(apiPackageRoot, "../../artifacts/review");

async function runDryRunCli(exportName: string): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const environment = { ...process.env, NODE_ENV: "development" };
    delete environment.OPENROUTER_API_KEY;
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "src/admin/enrich-subjects.ts",
        "--",
        "--dry-run",
        "--limit",
        "1",
        "--export",
        exportName,
      ],
      {
        cwd: apiPackageRoot,
        env: environment,
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Dry-run CLI child timed out"));
    }, 30_000);
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolvePromise();
      else reject(new Error(`Dry-run CLI exited ${code}: ${stderr}`));
    });
  });
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}

async function withFixture(
  run: (fixture: typeof productsTable.$inferSelect) => Promise<void>,
): Promise<void> {
  const id = `subject-store-it-${randomUUID()}`;
  try {
    const [fixture] = await db
      .insert(productsTable)
      .values({
        id,
        title: `Disposable subject store fixture ${id}`,
        author: "Integration Test",
        description: "A fox and a heron build a friendship beside a river.",
        readingLevel: "Grade 3",
        sourceUrl: "",
        formatLabel: "Hardcover",
        subjects: ["Juvenile Fiction > Animals > Foxes"],
        topSubjects: ["Juvenile Fiction"],
        tags: ["Friendship"],
        searchText: "",
      })
      .returning();
    assert.ok(fixture);
    await run(fixture);
  } finally {
    // The fixture ID is unique to this test; no catalog record is ever touched.
    await db.delete(productsTable).where(eq(productsTable.id, id));
  }
}

test("competing transactions grant exactly one active claim", async () => {
  await withFixture(async (fixture) => {
    const sourceHash = subjectSourceHash(fixture);
    const claims = await Promise.all([
      store.claim({
        product: fixture,
        sourceHash,
        force: false,
        retryFailed: false,
        attemptId: "competitor-a",
      }),
      store.claim({
        product: fixture,
        sourceHash,
        force: false,
        retryFailed: false,
        attemptId: "competitor-b",
      }),
    ]);
    assert.equal(claims.filter((claim) => claim.claimed).length, 1);
    assert.equal(
      claims.filter(
        (claim) => !claim.claimed && claim.reason === "active",
      ).length,
      1,
    );
  });
});

test("invalid persisted status is rejected at the adapter boundary", async () => {
  await withFixture(async (fixture) => {
    await db.execute(sql`
      update products
      set subject_summary_status = 'not-a-valid-status'
      where id = ${fixture.id}
    `);
    await assert.rejects(
      store.claim({
        product: fixture,
        sourceHash: subjectSourceHash(fixture),
        force: false,
        retryFailed: false,
      }),
      /Invalid subject summary status/,
    );
  });
});

test("failed records require explicit retry", async () => {
  await withFixture(async (fixture) => {
    const sourceHash = subjectSourceHash(fixture);
    await db
      .update(productsTable)
      .set({
        subjectSummaryStatus: "failed",
        subjectSummarySourceHash: sourceHash,
        subjectSummaryPromptVersion: "1",
        subjectSummaryError: "provider_error",
      })
      .where(eq(productsTable.id, fixture.id));

    const refused = await store.claim({
      product: fixture,
      sourceHash,
      force: false,
      retryFailed: false,
    });
    assert.deepEqual(refused, { claimed: false, reason: "failed" });

    const retried = await store.claim({
      product: fixture,
      sourceHash,
      force: false,
      retryFailed: true,
      attemptId: "explicit-retry",
    });
    assert.equal(retried.claimed, true);
  });
});

test("a stale generating lease can be recovered", async () => {
  await withFixture(async (fixture) => {
    const sourceHash = subjectSourceHash(fixture);
    await db
      .update(productsTable)
      .set({
        subjectSummaryStatus: "generating",
        subjectSummarySourceHash: sourceHash,
        subjectSummaryAttemptId: "interrupted-worker",
        subjectSummaryAttemptedAt: new Date(
          Date.now() - SUBJECT_SUMMARY_LEASE_MS - 1_000,
        ),
      })
      .where(eq(productsTable.id, fixture.id));

    const recovered = await store.claim({
      product: fixture,
      sourceHash,
      force: false,
      retryFailed: false,
      attemptId: "recovery-worker",
    });
    assert.equal(recovered.claimed, true);
    if (recovered.claimed) {
      assert.equal(recovered.attemptId, "recovery-worker");
    }
  });
});

test("superseded and expired attempts cannot overwrite", async () => {
  await withFixture(async (fixture) => {
    const sourceHash = subjectSourceHash(fixture);
    const first = await store.claim({
      product: fixture,
      sourceHash,
      force: false,
      retryFailed: false,
      attemptId: "old-attempt",
    });
    assert.equal(first.claimed, true);
    await db
      .update(productsTable)
      .set({ subjectSummaryAttemptId: "new-attempt" })
      .where(eq(productsTable.id, fixture.id));
    assert.deepEqual(
      await store.complete({
        productId: fixture.id,
        attemptId: "old-attempt",
        sourceHash,
        summary: "Animals and friendship shape this riverside story.",
        error: null,
      }),
      { committed: false, reason: "superseded" },
    );
    const [afterSuperseded] = await db
      .select()
      .from(productsTable)
      .where(eq(productsTable.id, fixture.id));
    assert.notEqual(afterSuperseded?.subjectSummaryStatus, "ready");
    assert.equal(afterSuperseded?.subjectSummary, null);
  });

  await withFixture(async (fixture) => {
    const sourceHash = subjectSourceHash(fixture);
    const claim = await store.claim({
      product: fixture,
      sourceHash,
      force: false,
      retryFailed: false,
      attemptId: "expired-attempt",
    });
    assert.equal(claim.claimed, true);
    await db
      .update(productsTable)
      .set({
        subjectSummaryAttemptedAt: new Date(
          Date.now() - SUBJECT_SUMMARY_LEASE_MS - 1_000,
        ),
      })
      .where(eq(productsTable.id, fixture.id));
    assert.deepEqual(
      await store.complete({
        productId: fixture.id,
        attemptId: "expired-attempt",
        sourceHash,
        summary: "Animals and friendship shape this riverside story.",
        error: null,
      }),
      { committed: false, reason: "expired" },
    );
    const [afterExpired] = await db
      .select()
      .from(productsTable)
      .where(eq(productsTable.id, fixture.id));
    assert.notEqual(afterExpired?.subjectSummaryStatus, "ready");
    assert.equal(afterExpired?.subjectSummary, null);
  });
});

test("source changes during generation prevent ready persistence", async () => {
  await withFixture(async (fixture) => {
    const sourceHash = subjectSourceHash(fixture);
    const claim = await store.claim({
      product: fixture,
      sourceHash,
      force: false,
      retryFailed: false,
      attemptId: "source-change-attempt",
    });
    assert.equal(claim.claimed, true);
    await db
      .update(productsTable)
      .set({ title: `${fixture.title} changed` })
      .where(eq(productsTable.id, fixture.id));

    assert.deepEqual(
      await store.complete({
        productId: fixture.id,
        attemptId: "source-change-attempt",
        sourceHash,
        summary: "Animals and friendship shape this riverside story.",
        error: null,
      }),
      { committed: false, reason: "changed" },
    );
    const [after] = await db
      .select()
      .from(productsTable)
      .where(eq(productsTable.id, fixture.id));
    assert.notEqual(after?.subjectSummaryStatus, "ready");
    assert.equal(after?.subjectSummary, null);
  });
});

test("completion rejects prohibited copy instead of persisting ready", async () => {
  await withFixture(async (fixture) => {
    const sourceHash = subjectSourceHash(fixture);
    const claim = await store.claim({
      product: fixture,
      sourceHash,
      force: false,
      retryFailed: false,
      attemptId: "invalid-copy-attempt",
    });
    assert.equal(claim.claimed, true);
    assert.deepEqual(
      await store.complete({
        productId: fixture.id,
        attemptId: "invalid-copy-attempt",
        sourceHash,
        summary: "This book is perfect, ideal, recommended, and safe.",
        error: null,
      }),
      { committed: true },
    );
    const [after] = await db
      .select()
      .from(productsTable)
      .where(eq(productsTable.id, fixture.id));
    assert.equal(after?.subjectSummaryStatus, "failed");
    assert.equal(after?.subjectSummary, null);
    assert.equal(after?.subjectSummaryError, "invalid_summary");
  });
});

test("actual dry-run CLI never creates or overwrites review files", async () => {
  const suffix = randomUUID();
  const absentName = `dry-run-absent-${suffix}.csv`;
  const sentinelName = `dry-run-sentinel-${suffix}.csv`;
  const absentPath = resolve(reviewRoot, absentName);
  const sentinelPath = resolve(reviewRoot, sentinelName);
  const sentinel = "must remain byte-for-byte unchanged\n";
  await mkdir(reviewRoot, { recursive: true });
  await writeFile(sentinelPath, sentinel, "utf8");
  try {
    await runDryRunCli(absentName);
    assert.equal(await exists(absentPath), false);
    await runDryRunCli(sentinelName);
    assert.equal(await readFile(sentinelPath, "utf8"), sentinel);
  } finally {
    await rm(absentPath, { force: true });
    await rm(sentinelPath, { force: true });
  }
});