import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SAVINGS_LABEL, discountedPrice } from "@workspace/pricing";
import { PriceDisplay } from "../src/components/price-display.tsx";

test("PriceDisplay renders the shared savings label for the applied price", () => {
  const catalogPrice = 14.99;
  const markup = renderToStaticMarkup(
    <PriceDisplay
      price={discountedPrice(catalogPrice)}
      catalogPrice={catalogPrice}
    />,
  );

  assert.match(markup, new RegExp(SAVINGS_LABEL));
  assert.match(markup, /\$11\.99/);
  assert.match(markup, /\$14\.99/);
});