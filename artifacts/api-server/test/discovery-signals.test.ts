import assert from "node:assert/strict";
import test from "node:test";
import { rankForSession } from "../src/domain/ranking-cache.ts";

const baseSignals = {
  queryText: null,
  interpretation: null,
  pickIds: ["filter-book"],
  pivotId: null,
  negativeIds: ["explicit-negative"],
};

test("unchanged discovery signals reuse the existing ranking cache", () => {
  const sessionId = "cache-regression-unchanged";
  const first = rankForSession(sessionId, 1, baseSignals);
  const second = rankForSession(sessionId, 1, baseSignals);

  assert.equal(first.cacheStatus, "miss");
  assert.equal(second.cacheStatus, "hit");
  assert.strictEqual(second.outcome, first.outcome);
});

test("removing a Filter signal invalidates cache without adding a negative", () => {
  const sessionId = "cache-regression-filter-removal";
  const afterRemoval = { ...baseSignals, pickIds: [] };

  assert.deepEqual(afterRemoval.negativeIds, baseSignals.negativeIds);
  assert.equal(rankForSession(sessionId, 1, baseSignals).cacheStatus, "miss");
  assert.equal(rankForSession(sessionId, 2, afterRemoval).cacheStatus, "miss");
  assert.equal(rankForSession(sessionId, 2, afterRemoval).cacheStatus, "hit");
});