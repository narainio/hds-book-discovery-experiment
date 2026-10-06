import assert from "node:assert/strict";
import test from "node:test";
import type { Session } from "@workspace/db";
import { catalog, type IndexedProduct } from "../src/domain/catalog";
import { rank } from "../src/domain/ranking";
import { interpret } from "../src/domain/interpreter";
import { computeThenCommit, prepareFilterSession } from "../src/services/filter";

const session: Session = {
  id: "unit-filter", modeId: "johnny", query: null, queryPromptId: null,
  querySource: null, queryInterpretation: null, pivotBookId: null,
  rankingVersion: 0, createdAt: new Date(0), updatedAt: new Date(0),
};

test("independent full-state inputs, replacement, duplicate idempotence and reset", async () => {
  const book = await prepareFilterSession(session, { queryText: "", pivotWorkId: "one" });
  const both = await prepareFilterSession(book, { queryText: "Funny graphic novels", pivotWorkId: "one" });
  assert.equal(both.pivotBookId, "one");
  const words = await prepareFilterSession(both, { queryText: both.query!, pivotWorkId: null });
  assert.equal(words.query, both.query);
  const replaced = await prepareFilterSession(both, { queryText: both.query!, pivotWorkId: "two" });
  assert.equal(replaced.pivotBookId, "two");
  const duplicate = await prepareFilterSession(replaced, { queryText: replaced.query!, pivotWorkId: "two" });
  assert.equal(duplicate.rankingVersion, replaced.rankingVersion);
  const onlyBook = await prepareFilterSession(replaced, { queryText: "", pivotWorkId: "two" });
  assert.equal(onlyBook.query, null);
  assert.equal(onlyBook.pivotBookId, "two");
  const empty = await prepareFilterSession(onlyBook, { queryText: "", pivotWorkId: null });
  assert.equal(empty.query, null);
  assert.equal(empty.pivotBookId, null);
  const wordsFirst = await prepareFilterSession(session, { queryText: "Funny graphic novels", pivotWorkId: null });
  assert.equal(wordsFirst.queryInterpretation?.source, "curated");
  assert.equal(session.rankingVersion, 0);
});

test("failed ranking or serialization never reaches persistence; commit failure returns no success", async () => {
  let writes = 0;
  const commit = async () => { writes++; };
  await assert.rejects(computeThenCommit(async () => { throw new Error("ranking unavailable"); }, commit));
  await assert.rejects(computeThenCommit(async () => ({ invalid: 1n }), commit));
  assert.equal(writes, 0);
  await assert.rejects(computeThenCommit(async () => "results", async () => { throw new Error("DB rollback"); }));
  assert.equal(await computeThenCommit(async () => "results", commit), "results");
  assert.equal(writes, 1);
});

test("full eligibility includes example and unrelated books; hidden picks have no influence", () => {
  const oldProducts = catalog.products;
  const oldIds = catalog.byId;
  // Deliberately small unit-only corpus, never written to storage.
  const product = (id: string, term: string) => ({
    id, title: id, author: "", seriesName: null, subjects: [], topSubjects: [],
    tags: [], subjectSet: new Set(), topSubjectSet: new Set(), tagSet: new Set(),
    vector: new Map([[term, 1]]), searchText: term, bookScore: 5, awardCount: 0,
    isSpanishEdition: false,
  }) as unknown as IndexedProduct;
  try {
    catalog.products = [product("example", "funny"), product("unrelated", "space"), product("negative", "scary")];
    catalog.byId = new Map(catalog.products.map(p => [p.id, p]));
    const signals = { queryText: null, interpretation: null, pickIds: [], pivotId: null, negativeIds: ["negative"] };
    const baseline = rank(signals);
    const selected = rank({ ...signals, pivotId: "example" });
    assert.deepEqual(new Set(selected.ranked.map(e => e.product.id)), new Set(baseline.ranked.map(e => e.product.id)));
    assert.equal(selected.ranked.length, 2);
    assert.ok(selected.ranked.find(e => e.product.id === "example")!.score > baseline.ranked.find(e => e.product.id === "example")!.score);
    assert.deepEqual(rank({ ...signals, pickIds: ["example", "unrelated"] }), baseline);
    const queryText = "Funny mysteries, not too scary";
    const interpretation = interpret(queryText);
    assert.ok(interpretation.reduce.includes("scary"));
    const combined = rank({ ...signals, queryText, interpretation, pivotId: "example" });
    assert.deepEqual(new Set(combined.ranked.map(e => e.product.id)), new Set(baseline.ranked.map(e => e.product.id)));
  } finally {
    catalog.products = oldProducts;
    catalog.byId = oldIds;
  }
});