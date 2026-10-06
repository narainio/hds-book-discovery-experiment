import assert from "node:assert/strict";
import { mock, test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Cart regressions formerly covered via the legacy picks page, now exercised
// on Cart and BookCard directly: Cart stays independent of Your Filter.
let price: number | null = 15.99;
let cartLines: unknown[] = [];
const mutation = () => ({ mutate() {}, isPending: false });
let setBookCalls = 0;
let activeId: string | null = null;

mock.module("wouter", {
  namedExports: {
    Link: ({ children, href }: React.PropsWithChildren<{ href: string }>) => React.createElement("a", { href }, children),
    useLocation: () => ["/cart", () => {}],
  },
});
mock.module("@workspace/api-client-react", {
  namedExports: {
    useGetCart: () => ({ data: { items: cartLines, itemCount: cartLines.length, subtotal: 0, savings: 0, total: 0, currency: "USD" }, isLoading: false }),
    useUpdateCartItem: mutation, useRemoveCartItem: mutation,
    getGetCartQueryKey: () => ["cart"], getGetSessionQueryKey: () => ["session"],
  },
});
mock.module("@tanstack/react-query", { namedExports: { useQueryClient: () => ({}) } });
mock.module(new URL("../src/hooks/use-session.tsx", import.meta.url).href, {
  namedExports: { useSession: () => ({ sessionId: "fixture", session: { cartIds: ["book"] } }) },
});
mock.module(new URL("../src/hooks/use-your-filter.tsx", import.meta.url).href, {
  namedExports: {
    useYourFilter: () => ({
      view: { filter: { words: null, book: activeId ? { id: activeId, title: "t", coverImageUrl: null } : null } },
      pending: null, error: null,
      controller: { setBook() { setBookCalls++; } },
    }),
  },
});
const { default: Cart } = await import("../src/pages/cart.tsx");
const { BookCard } = await import("../src/components/book-card.tsx");

const book = () => ({ id: "book", title: "A long book title", author: "Author", hasCover: false, coverImageUrl: null,
  price, catalogPrice: 19.99, currency: "USD", formatLabel: "Hardcover" });

test("cart items can still be removed if their price becomes unavailable", () => {
  price = null;
  cartLines = [{ book: book(), quantity: 1, lineTotal: 0 }];
  const html = renderToStaticMarkup(<Cart />);
  const button = html.match(/<button\b[^>]*>(?:(?!<\/button>)[\s\S])*Remove<\/button>/)?.[0];
  assert.ok(button);
  assert.doesNotMatch(button, /disabled=""/);
  price = 15.99;
});

test("book card example action is independent of Cart membership", () => {
  for (const example of [false, true]) {
    activeId = example ? "book" : null;
    const html = renderToStaticMarkup(<BookCard book={book() as never} />);
    assert.match(html, example ? /In Filter/ : /Use to shape results/);
    assert.doesNotMatch(html, /Add to Filter|Remove from Filter|cart/i);
  }
  activeId = null;
  assert.equal(setBookCalls, 0, "rendering never selects an example");
});
