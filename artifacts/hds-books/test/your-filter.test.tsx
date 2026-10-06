import assert from "node:assert/strict";
import { mock, test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

let filter: { words: string | null; book: { id: string; title: string; coverImageUrl: null } | null } = { words: null, book: null };
let error: unknown = null;
mock.module("wouter", {
  namedExports: { Link: ({ children, href }: React.PropsWithChildren<{ href: string }>) => React.createElement("a", { href }, children) },
});
mock.module(new URL("../src/hooks/use-your-filter.tsx", import.meta.url).href, {
  namedExports: {
    useYourFilter: () => ({ view: { filter }, pending: null, error, announcement: "", draft: filter.words ?? "", status: "ready", controller: {} }),
  },
});
const { YourFilter } = await import("../src/components/your-filter.tsx");
const book = { id: "b1", title: "A Very Long Real Catalog Title", coverImageUrl: null };
const html = () => renderToStaticMarkup(<YourFilter />);

test("empty state copy", () => {
  filter = { words: null, book: null };
  const h = html();
  for (const t of ["Your Filter", "Nothing added yet", "Describe what you’re looking for (optional)", "Or use a book below to shape these results."]) assert.ok(h.includes(t), t);
});

test("book-only state", () => {
  filter = { words: null, book };
  const h = html();
  for (const t of ["1 book shaping these results", "Using as an example · not a required match", book.title, "Remove book"]) assert.ok(h.includes(t), t);
});

test("words-only state has edit and clear", () => {
  filter = { words: "Funny mysteries, not too scary", book: null };
  const h = html();
  for (const t of ["Your direction", "Edit direction", "Clear direction", "Funny mysteries, not too scary"]) assert.ok(h.includes(t), t);
  assert.doesNotMatch(h, /Remove book/);
});

test("combined state copy and independent controls", () => {
  filter = { words: "dragons", book };
  const h = html();
  for (const t of ["A direction and 1 example shape these results", "Your direction", "Edit direction", "Clear direction", "Remove book",
    "Removing the book keeps your direction. Changing your direction keeps the book."]) assert.ok(h.includes(t), t);
});

test("unsynced error disables changes and offers retry without dismiss", () => {
  filter = { words: "dragons", book };
  error = { kind: "unsynced", message: "could not confirm", failed: null };
  const h = html();
  assert.match(h, /role="alert"/);
  assert.match(h, /Retry/);
  assert.doesNotMatch(h, /Dismiss/);
  assert.match(h, /data-testid="button-remove-book" disabled=""/);
  error = null;
});

test("placeholder uses real quotes and long title stacks above Remove book", () => {
  filter = { words: null, book };
  const h = html();
  assert.match(h, /placeholder="Try “Funny mysteries, not too scary”"/);
  assert.doesNotMatch(h, /\\u201c/);
  assert.match(h, /data-testid="block-filter-book"[^>]*class="[^"]*flex-col|class="[^"]*flex-col[^"]*" data-testid="block-filter-book"/);
});
