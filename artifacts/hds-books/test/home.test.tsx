import assert from "node:assert/strict";
import { mock, test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

let view: unknown = null;
let committed: unknown = null;
let modes: unknown[] = [];
let modesNotice: string | null = null;

mock.module("wouter", {
  namedExports: {
    Link: ({ children, href, ...rest }: React.PropsWithChildren<{ href: string }>) => React.createElement("a", { href, ...rest }, children),
    useLocation: () => ["/", () => {}],
  },
});
mock.module("@workspace/api-client-react", { namedExports: { assessIntention: async () => ({}) } });
mock.module(new URL("../src/hooks/use-your-filter.tsx", import.meta.url).href, {
  namedExports: { useYourFilter: () => ({ view }) },
});
mock.module(new URL("../src/hooks/use-working-context.tsx", import.meta.url).href, {
  namedExports: {
    useWorkingContext: () => ({ committed, actions: {} }),
    useModes: () => ({ modes, notice: modesNotice, writable: true }),
  },
});

const { default: Home } = await import("../src/pages/home.tsx");
const html = () => renderToStaticMarkup(<Home />);

test("Home: question, labeled composer, actions and example prompts", () => {
  view = null; committed = null; modes = [];
  const h = html();
  for (const t of [
    "What are you shopping for?",
    "Currently exploring books.",
    '<label for="home-intention"',
    "Describe what you’re looking for",
    'placeholder="For example, books for Johnny, age 10, who likes funny mysteries."',
    ">Find books<",
    "Browse all books",
    "Funny graphic novels", "Animal adventures", "Mysteries that aren’t too scary",
    ">Try:<",
  ]) assert.ok(h.includes(t), t);
  // Suggestions only populate the composer: they are plain buttons, not links or submits.
  assert.doesNotMatch(h, /type="submit"[^>]*data-testid="button-example/);
  assert.match(h, /<button type="button" data-testid="button-example-funny"/);
  // Placed directly under the input, above the main actions.
  assert.ok(h.indexOf("input-home-intention") < h.indexOf("button-example-funny"));
  assert.ok(h.indexOf("button-example-mysteries") < h.indexOf("button-find-books"));
  assert.doesNotMatch(h, /Start discovering|Continue discovering|Examples:/);
  // No Cart reassurance without active work.
  assert.doesNotMatch(h, /Cart stays unchanged/);
});

test("Home: Your Modes empty state", () => {
  view = null; committed = null; modes = [];
  const h = html();
  assert.ok(h.includes("Your Modes"));
  assert.ok(h.includes("No saved Modes yet."));
  assert.ok(h.includes("You can save a Filter while discovering."));
});

test("Home: Continue discovering with a factual summary, clickable Mode rows", () => {
  view = { filter: { words: "dragons", book: null }, session: { negativeCount: 1 } };
  committed = { version: 1, sessionId: "s", base: "dragons", refinements: [], sourceModeId: null, sourceModeName: null, sourceModeContext: null, origin: "intention", started: true, scrollY: 0 };
  modes = [{ id: "m1", schemaVersion: 1, name: "Books for Johnny", baseIntention: null, refinements: [], context: { modeId: "johnny", label: "Book for Johnny · age 10" }, selectedProductIds: [], createdAt: "2026-10-20T00:00:00Z" }];
  modesNotice = "Saved Modes couldn’t be read and were set aside.";
  const h = html();
  assert.match(h, /href="\/discover"/);
  assert.ok(h.includes("Continue discovering"));
  assert.ok(h.includes("“dragons” · 1 fewer like this"));
  assert.ok(h.includes("Starts a new Filter. Your Cart stays unchanged."));
  // One arrow: the icon only, no arrow in the label.
  assert.doesNotMatch(h, /→/);
  assert.ok(h.includes("Age 10 · Books"));
  assert.doesNotMatch(h, /All books · Book for Johnny/);
  // The whole row is one button containing name and summary; Open is a non-interactive cue.
  const row = h.slice(h.indexOf('data-testid="row-mode-m1"'), h.indexOf("</li>", h.indexOf('data-testid="row-mode-m1"')));
  assert.equal((row.match(/<button/g) ?? []).length, 1);
  assert.doesNotMatch(row, /<a /);
  assert.match(row, /<button type="button"[^>]*data-testid="button-open-mode-m1"[^>]*>.*Books for Johnny.*Age 10 · Books.*<span aria-hidden="true"[^>]*>Open/);
  assert.ok(h.includes("set aside"));
});

test("Home: Continue discovering only when it resumes something", () => {
  modes = []; modesNotice = null;
  const ctx = (scrollY: number) => ({ version: 1, sessionId: "s", base: null, refinements: [], sourceModeId: null, sourceModeName: null, sourceModeContext: null, origin: "browse", started: true, scrollY });
  // Browse all with no position duplicates Browse all books: omitted.
  view = { filter: { words: null, book: null }, session: { negativeCount: 0 } };
  committed = ctx(0);
  assert.doesNotMatch(html(), /Continue discovering|Cart stays unchanged/);
  // A real browsing position is resumable; no Filter, so no Cart hint.
  committed = ctx(1200);
  const h = html();
  assert.ok(h.includes("Continue discovering"));
  assert.doesNotMatch(h, /Cart stays unchanged/);
  // A book in Filter is meaningful active work.
  view = { filter: { words: null, book: { id: "b", title: "Wonder (Paperback)", coverImageUrl: null } }, session: { negativeCount: 0 } };
  committed = ctx(0);
  const b = html();
  assert.ok(b.includes("Continue discovering"));
  assert.ok(b.includes("In Filter: Wonder"));
  assert.ok(b.includes("Starts a new Filter. Your Cart stays unchanged."));
});
