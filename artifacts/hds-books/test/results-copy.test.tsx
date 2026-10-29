import assert from "node:assert/strict";
import { test } from "node:test";
import { catalogScope, resultsCountText } from "../src/lib/results-copy.ts";
import { resultsHeading } from "../src/lib/filter-controller.ts";

test("result counts say which quantity is shown", () => {
  assert.equal(resultsCountText(24, 2412), "24 of 2,412 books shown");
  assert.equal(resultsCountText(48, 2412), "48 of 2,412 books shown");
  // Everything is loaded, or the total is unknown: never invent a total.
  assert.equal(resultsCountText(7, 7), "7 books shown");
  assert.equal(resultsCountText(1, null), "1 book shown");
  assert.doesNotMatch(resultsCountText(24, 2412), /matching|for this mode|About/);
});

test("catalog scope comes from the engine's grade label", () => {
  assert.equal(catalogScope("age 10 · grades 4–5"), "Catalog: grades 4–5");
  assert.equal(catalogScope("grades 6–8"), "Catalog: grades 6–8");
  assert.equal(catalogScope("age 10"), null);
  assert.equal(catalogScope(undefined), null);
});

test("stable results headings", () => {
  const book = { id: "b", title: "t", coverImageUrl: null };
  assert.equal(resultsHeading({ words: null, book: null }), "Books to explore");
  for (const f of [{ words: "dragons", book: null }, { words: null, book }, { words: "dragons", book }]) {
    assert.equal(resultsHeading(f), "Recommended next");
  }
});
