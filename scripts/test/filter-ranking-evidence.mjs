import assert from "node:assert/strict";

// Opt-in live fork-only acceptance: run after the fork's API workflow starts.
// Creates one fresh session. No original API, preexisting session, or catalog writes.
const base = "http://localhost:80/api";
const queryText = "Funny mysteries, not too scary";
const pageSize = 48;

async function api(path, method = "GET", body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json();
  assert.ok(response.ok, `${method} ${path}: HTTP ${response.status} ${JSON.stringify(payload)}`);
  return payload;
}

const ids = (response) => response.results.map(({ book }) => book.id);
const sameResults = (a, b, label) => {
  assert.ok(JSON.stringify(a.results) === JSON.stringify(b.results), label);
};
const compact = (response) => response.results.slice(0, 10).map(({ book, score, reason }, i) => ({
  rank: i + 1, id: book.id, title: book.title, score, reason,
}));

async function main() {
  const session = await api("/session", "POST", {});
  const sessionPath = `/session/${encodeURIComponent(session.sessionId)}`;
  const discover = (offset = 0, limit = 24) =>
    api(`/discover?sessionId=${encodeURIComponent(session.sessionId)}&limit=${limit}&offset=${offset}`);
  const apply = (query, bookId) =>
    api(`${sessionPath}/filter`, "POST", { queryText: query, pivotWorkId: bookId });

  async function allResults(first) {
    const rows = [...first.results];
    assert.ok(Number.isSafeInteger(first.totalAvailable) && first.totalAvailable > 0);
    while (rows.length < first.totalAvailable) {
      const offset = rows.length;
      const next = await discover(offset, pageSize);
      assert.equal(next.rankingVersion, first.rankingVersion, "Ranking changed while paginating");
      assert.equal(next.totalAvailable, first.totalAvailable);
      assert.ok(next.results.length > 0, `Empty page at offset ${offset}`);
      rows.push(...next.results);
    }
    assert.equal(rows.length, first.totalAvailable);
    assert.equal(new Set(rows.map(({ book }) => book.id)).size, rows.length, "Duplicate book across pages");
    return rows;
  }

  const baseline = await discover();
  const catalogSize = (await api("/catalog/stats")).totalBooks;
  assert.equal(baseline.totalAvailable, catalogSize, "Browse eligibility differs from catalog");
  const baselineAll = await allResults(baseline);
  const typeahead = await api("/typeahead?q=The%20Gator%20Samaritan");
  const example = typeahead.groups.flatMap((group) => group.items)
    .find((entry) => entry.kind === "book" && entry.text.toLowerCase().includes("gator samaritan"));
  assert.ok(example?.bookId, "Actual Gator Samaritan example not found in catalog");
  const exampleId = example.bookId;

  const bookOnly = await apply("", exampleId);
  assert.equal(bookOnly.session.pivotId, exampleId);
  assert.equal(bookOnly.session.query, null);
  assert.equal(bookOnly.rankingVersion, baseline.rankingVersion + 1);
  assert.notDeepEqual(ids(bookOnly), ids(baseline), "Example must re-rank the first page");
  const bookAll = await allResults(bookOnly);
  const combined = await apply(queryText, exampleId);
  assert.equal(combined.session.query, queryText);
  assert.equal(combined.session.pivotId, exampleId);
  assert.ok(combined.interpretation.reduce.includes("scary"), "Query should reduce scary material");
  assert.equal(combined.rankingVersion, bookOnly.rankingVersion + 1);
  assert.notDeepEqual(ids(combined), ids(bookOnly), "Words must affect ordering with same example");
  const duplicate = await apply(queryText, exampleId);
  assert.equal(duplicate.rankingVersion, combined.rankingVersion, "Identical full-state submission should be idempotent");
  sameResults(duplicate, combined, "Duplicate full-state submission must preserve ranking and reasons");
  sameResults(await discover(), combined, "Atomic response must match a fresh discovery read");

  // Read all pages: a first-page sample is not proof of full catalog eligibility.
  const combinedAll = await allResults(combined);
  const eligible = new Set(baselineAll.map(({ book }) => book.id));
  assert.deepEqual(new Set(bookAll.map(({ book }) => book.id)), eligible);
  assert.deepEqual(new Set(combinedAll.map(({ book }) => book.id)), eligible);
  assert.ok(eligible.has(exampleId), "The example must remain eligible");
  const unrelated = baselineAll.find(({ book }) =>
    book.id !== exampleId && !/myster|detective|gator/i.test(book.title));
  assert.ok(unrelated && combinedAll.some(({ book }) => book.id === unrelated.book.id),
    "Unrelated candidate must remain eligible");

  const priced = baseline.results.find(({ book }) => book.price !== null)?.book;
  assert.ok(priced, "Need real priced book for Cart independence");
  const cart = await api(`${sessionPath}/cart`, "POST", { bookId: priced.id, quantity: 1 });
  assert.equal(cart.itemCount, 1);
  sameResults(await discover(), combined, "Cart must not shape combined ranking or reasons");
  assert.deepEqual((await api(sessionPath)).cartIds, [priced.id]);

  const replacement = combined.results.find(({ book }) => book.id !== exampleId)?.book;
  assert.ok(replacement, "Need another real book for replacement");
  const replaced = await apply(queryText, replacement.id);
  assert.equal(replaced.session.pivotId, replacement.id);
  assert.equal(replaced.session.query, queryText);
  assert.equal(replaced.rankingVersion, combined.rankingVersion + 1);
  assert.notDeepEqual(ids(replaced), ids(combined));
  const wordsOnly = await apply(queryText, null);
  assert.equal(wordsOnly.session.pivotId, null);
  assert.equal(wordsOnly.session.query, queryText);
  assert.equal(wordsOnly.rankingVersion, replaced.rankingVersion + 1);
  const restored = await apply("", replacement.id);
  assert.equal(restored.session.query, null);
  assert.equal(restored.session.pivotId, replacement.id);
  const cleared = await apply("", null);
  assert.equal(cleared.session.query, null);
  assert.equal(cleared.session.pivotId, null);
  sameResults(cleared, baseline, "Clear must restore browse order and reasons");

  sameResults(await discover(), baseline, "Cart must not shape browse");
  const clearWithCart = await apply("", null);
  assert.deepEqual(clearWithCart.session.cartIds, [priced.id], "Filter clear must not clear Cart");
  sameResults(clearWithCart, baseline, "Clear with Cart must restore browse");
  await api(`${sessionPath}/cart/${encodeURIComponent(priced.id)}`, "DELETE");

  console.log(JSON.stringify({
    status: "PASS", sessionId: session.sessionId, catalogSize, queryText,
    example: { id: exampleId, title: example.text },
    unrelated: { id: unrelated.book.id, title: unrelated.book.title },
    replacement: { id: replacement.id, title: replacement.title },
    eligibility: { baseline: baselineAll.length, bookOnly: bookAll.length, combined: combinedAll.length, sameIds: true },
    baseline: { version: baseline.rankingVersion, firstTen: compact(baseline), exampleRank: baselineAll.findIndex(({ book }) => book.id === exampleId) + 1 },
    bookOnly: { version: bookOnly.rankingVersion, firstTen: compact(bookOnly), exampleRank: bookAll.findIndex(({ book }) => book.id === exampleId) + 1 },
    combined: { version: combined.rankingVersion, interpretation: combined.interpretation, firstTen: compact(combined), exampleRank: combinedAll.findIndex(({ book }) => book.id === exampleId) + 1 },
    assertions: ["atomic response matches GET", "idempotent duplicate", "replacement", "independent words/example clears", "complete eligibility", "Cart independent"],
  }, null, 2));
}

await main();