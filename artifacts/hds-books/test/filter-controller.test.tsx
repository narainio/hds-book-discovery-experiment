import assert from "node:assert/strict";
import { test } from "node:test";
import { FilterController, sameFilter, resultsHeading } from "../src/lib/filter-controller.ts";
import type { FilterInput, FilterResult } from "../src/lib/filter-controller.ts";

const bookA = { id: "a", title: "Book A", coverImageUrl: null };
const bookB = { id: "b", title: "Book B", coverImageUrl: null };

function result(words: string | null, book: typeof bookA | null, tag = "", ids: string[] = [], hasMore = false, version = 1): FilterResult {
  const shaping = { modeLabel: "m", query: words, pivot: book, picks: [], negatives: [], hasSignals: !!(words || book), signalCount: 0, summaryText: "" };
  const session = { sessionId: "s", modeId: "m", modeLabel: "m", gradeLabel: "g", pickCount: 0, cartCount: 3, negativeCount: 0, shaping, rankingVersion: 1 };
  const results = ids.map((id) => ({ book: { id, title: id }, score: 1 }));
  const discover = { heading: tag, results, resultCount: results.length, totalAvailable: 99, hasMore, personalized: false, relaxed: false, shaping, rankingVersion: version, session };
  return { session, discover } as unknown as FilterResult;
}

function deferred<T>() {
  let resolve!: (v: T) => void; let reject!: (e: unknown) => void;
  const promise = new Promise<T>((r, j) => { resolve = r; reject = j; });
  return { promise, resolve, reject };
}

type Call = { desired: FilterInput; d: ReturnType<typeof deferred<FilterResult>> };

function harness(server: { words: string | null; book: typeof bookA | null } = { words: null, book: null }) {
  const calls: Call[] = [];
  let readFails = false;
  const c = new FilterController({
    read: async () => { if (readFails) throw new Error("down"); return result(server.words, server.book); },
    commit: (desired) => { const d = deferred<FilterResult>(); calls.push({ desired, d }); return d.promise; },
  });
  return { c, calls, server, setReadFails: (v: boolean) => { readFails = v; } };
}

const tick = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };
const ok = (call: Call) => call.d.resolve(result(call.desired.words, call.desired.book));

test("full lifecycle: book, words, independent removals, back to start", async () => {
  const { c, calls } = harness();
  await c.load();
  assert.equal(resultsHeading(c.getSnapshot().view!.filter), "Books to explore");
  c.setBook(bookA); ok(calls[0]); await tick();
  c.setWords("Funny mysteries, not too scary"); ok(calls[1]); await tick();
  assert.deepEqual(calls[1].desired.book, bookA);
  c.removeBook(); ok(calls[2]); await tick();
  assert.equal(calls[2].desired.words, "Funny mysteries, not too scary");
  assert.equal(resultsHeading(c.getSnapshot().view!.filter), "Books shaped by your direction");
  c.setBook(bookA); ok(calls[3]); await tick();
  c.clearWords(); ok(calls[4]); await tick();
  assert.deepEqual(calls[4].desired, { words: null, book: bookA, promptId: undefined });
  c.removeBook(); ok(calls[5]); await tick();
  assert.ok(sameFilter(c.getSnapshot().view!.filter, { words: null, book: null }));
  assert.match(c.getSnapshot().announcement, /Books to explore/);
});

test("same example is idempotent; different example replaces", async () => {
  const { c, calls } = harness();
  await c.load();
  c.setBook(bookA); ok(calls[0]); await tick();
  c.setBook(bookA);
  assert.equal(calls.length, 1);
  c.setBook(bookB); ok(calls[1]); await tick();
  assert.equal(c.getSnapshot().view!.filter.book!.id, "b");
});

test("rapid changes serialize and never show stale results as current", async () => {
  const { c, calls } = harness();
  await c.load();
  c.setBook(bookA);
  c.setWords("dragons");
  c.setBook(bookB);
  assert.equal(calls.length, 1, "one request in flight");
  assert.equal(c.getSnapshot().announcement, "");
  ok(calls[0]); await tick();
  assert.equal(c.getSnapshot().pending!.book!.id, "b", "still pending newer intent");
  assert.equal(c.getSnapshot().announcement, "");
  assert.equal(calls.length, 2);
  assert.deepEqual([calls[1].desired.words, calls[1].desired.book!.id], ["dragons", "b"]);
  ok(calls[1]); await tick();
  assert.equal(c.getSnapshot().pending, null);
  assert.match(c.getSnapshot().announcement, /direction and example/);
});

test("rejected update keeps previous view and draft; retry succeeds", async () => {
  const { c, calls, server } = harness();
  await c.load();
  c.setBook(bookA); ok(calls[0]); await tick();
  server.book = bookA;
  c.setDraft("space pirates");
  c.setWords("space pirates");
  calls[1].d.reject({ status: 400 }); await tick(); await tick();
  const s = c.getSnapshot();
  assert.equal(s.error!.kind, "update");
  assert.equal(s.view!.filter.words, null, "failed words never shown as applied");
  assert.equal(s.draft, "space pirates");
  assert.equal(calls.length, 2, "server matched; no restore needed");
  c.retry(); ok(calls[2]); await tick();
  assert.equal(c.getSnapshot().view!.filter.words, "space pirates");
  assert.equal(c.getSnapshot().error, null);
});

test("persisted-but-undelivered update is restored to the visible Filter", async () => {
  const h = harness();
  await h.c.load();
  h.c.setBook(bookA);
  h.server.book = bookA; // server committed, response lost
  h.calls[0].d.reject(new TypeError("network")); await tick(); await tick();
  assert.equal(h.calls.length, 2, "restore commit issued");
  assert.equal(h.calls[1].desired.book, null);
  ok(h.calls[1]); await tick(); await tick();
  const s = h.c.getSnapshot();
  assert.equal(s.error!.kind, "update");
  assert.equal(s.view!.filter.book, null);
});

test("unreconcilable failure blocks changes until retry", async () => {
  const h = harness();
  await h.c.load();
  h.setReadFails(true);
  h.c.setWords("robots");
  h.calls[0].d.reject(new TypeError("network")); await tick(); await tick();
  assert.equal(h.c.getSnapshot().error!.kind, "unsynced");
  h.c.setBook(bookA);
  assert.equal(h.calls.length, 1, "blocked");
  h.c.dismissError();
  assert.equal(h.c.getSnapshot().error!.kind, "unsynced");
  h.c.retry(); ok(h.calls[1]); await tick();
  assert.equal(h.c.getSnapshot().view!.filter.words, "robots");
  assert.equal(h.c.getSnapshot().error, null);
});

test("failed initial load offers retry", async () => {
  const h = harness();
  h.setReadFails(true);
  await h.c.load();
  assert.equal(h.c.getSnapshot().status, "load-error");
  h.setReadFails(false);
  h.c.retry(); await tick();
  assert.equal(h.c.getSnapshot().status, "ready");
});

test("Show more appends pages for the committed filter only", async () => {
  let page: () => Promise<FilterResult> = async () => result(null, null, "", ["c", "d"], false);
  const c = new FilterController({
    read: async () => result(null, null, "", ["a", "b"], true),
    readPage: () => page(),
    commit: async (d) => result(d.words, d.book, "", ["x"], true, 2),
  });
  await c.load();
  await c.loadMore();
  assert.deepEqual(c.getSnapshot().view!.discover.results.map((r) => r.book.id), ["a", "b", "c", "d"]);
  assert.equal(c.getSnapshot().view!.discover.hasMore, false);
});

test("Show more failure keeps existing results; mismatched page re-reads", async () => {
  let fail = true;
  let reads = 0;
  const c = new FilterController({
    read: async () => { reads++; return result(null, null, "", ["a"], true); },
    readPage: async () => { if (fail) throw new Error("down"); return result("other", null, "", ["z"], false); },
    commit: async (d) => result(d.words, d.book),
  });
  await c.load();
  await c.loadMore();
  assert.equal(c.getSnapshot().more, "error");
  assert.deepEqual(c.getSnapshot().view!.discover.results.map((r) => r.book.id), ["a"]);
  fail = false;
  await c.loadMore(); await tick();
  assert.deepEqual(c.getSnapshot().view!.discover.results.map((r) => r.book.id), ["a"], "stale page not appended");
  assert.equal(reads, 2, "view re-read after mismatch");
});

test("refresh after a negative waits for in-flight filter change", async () => {
  let reads = 0;
  const calls: ReturnType<typeof deferred<FilterResult>>[] = [];
  const c = new FilterController({
    read: async () => { reads++; return result(null, bookA); },
    commit: () => { const d = deferred<FilterResult>(); calls.push(d); return d.promise; },
  });
  await c.load();
  c.removeBook();
  c.refresh();
  assert.equal(reads, 1, "not read while change in flight");
  calls[0].resolve(result(null, null)); await tick();
  assert.equal(reads, 2, "re-read after change settled");
});
