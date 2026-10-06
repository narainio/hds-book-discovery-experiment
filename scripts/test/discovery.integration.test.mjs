import assert from "node:assert/strict";
import test from "node:test";

// Opt-in command: requires the existing local API workflow and imported catalog.
// Uses only a new test session; never changes products or another user's session.
const base = "http://localhost:80/api";

async function api(path, method = "GET", body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.ok(response.ok, `${method} ${path}: HTTP ${response.status}`);
  return response.json();
}

test("Atomic Filter, explicit negatives, and Cart retain separate semantics and prices", async () => {
  const initial = await api("/session", "POST", {});
  const sessionPath = `/session/${initial.sessionId}`;
  const discoverPath = `/discover?sessionId=${initial.sessionId}`;
  const baseline = await api(discoverPath);
  const book = baseline.results.find(({ book }) => book.price !== null)?.book;
  assert.ok(book, "The development catalog must contain a priced book");

  try {
    const cart = await api(`${sessionPath}/cart`, "POST", { bookId: book.id, quantity: 2 });
    assert.equal(cart.items[0].lineTotal, Number((book.price * 2).toFixed(2)));
    assert.equal(cart.subtotal, cart.items[0].lineTotal);
    assert.equal(cart.items[0].book.catalogPrice, book.catalogPrice);
    assert.deepEqual((await api(discoverPath)).results, baseline.results,
      "Cart additions must not affect recommendation order or explanations");
    assert.deepEqual((await api(sessionPath)).pickIds, []);

    const filtered = await api(`${sessionPath}/filter`, "POST", { queryText: "", pivotWorkId: book.id });
    assert.equal(filtered.session.pivotId, book.id);
    assert.deepEqual(filtered.session.negativeIds, []);
    assert.deepEqual(filtered.session.cartIds, [book.id]);
    const removed = await api(`${sessionPath}/filter`, "POST", { queryText: "", pivotWorkId: null });
    assert.equal(removed.session.pivotId, null);
    assert.deepEqual(removed.session.negativeIds, [], "Removing Filter evidence is not negative feedback");
    assert.deepEqual(removed.session.cartIds, [book.id]);
    assert.deepEqual((await api(discoverPath)).results, baseline.results);

    const pivot = await api(`${sessionPath}/filter`, "POST", { queryText: "", pivotWorkId: book.id });
    assert.equal(pivot.session.pivotId, book.id);
    assert.deepEqual(pivot.session.cartIds, [book.id]);
    const pivotResults = await api(discoverPath);
    assert.notDeepEqual(pivotResults.results, baseline.results);
    const clearedPivot = await api(`${sessionPath}/filter`, "POST", { queryText: "", pivotWorkId: null });
    assert.equal(clearedPivot.session.pivotId, null);
    assert.deepEqual((await api(discoverPath)).results, baseline.results);

    const negative = await api(`${sessionPath}/negatives`, "POST", { bookId: book.id });
    assert.deepEqual(negative.negativeIds, [book.id]);
    const clear = await api(`${sessionPath}/filter`, "POST", { queryText: "", pivotWorkId: null });
    assert.deepEqual(clear.session.negativeIds, [book.id], "Clearing Filter must not clear negative evidence");
    assert.deepEqual(clear.session.cartIds, [book.id], "Clearing Filter must preserve purchase intent");
  } finally {
    await api(`${sessionPath}/filter`, "POST", { queryText: "", pivotWorkId: null });
    await api(`${sessionPath}/negatives/${book.id}`, "DELETE");
    await api(`${sessionPath}/cart/${book.id}`, "DELETE");
  }
});