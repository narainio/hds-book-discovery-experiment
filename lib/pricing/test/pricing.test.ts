import assert from "node:assert/strict";
import test from "node:test";
import {
  SAVINGS_LABEL,
  STANDARD_DISCOUNT_RATE,
  discountedPrice,
} from "../src/index.ts";

test("the savings label is derived from the applied discount", () => {
  const displayedPercentage = Number(SAVINGS_LABEL.match(/\d+(?:\.\d+)?/)?.[0]);

  assert.equal(SAVINGS_LABEL, "Save 20%");
  assert.equal(displayedPercentage / 100, STANDARD_DISCOUNT_RATE);
});

test("discountedPrice preserves the existing cent rounding", () => {
  assert.equal(discountedPrice(14.99), 11.99);
  assert.equal(discountedPrice(11.99), 9.59);
  assert.equal(discountedPrice(0.01), 0.01);
  assert.equal(discountedPrice(null), null);
});