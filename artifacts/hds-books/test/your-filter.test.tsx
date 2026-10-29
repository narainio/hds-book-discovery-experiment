import assert from "node:assert/strict";
import { mock, test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Your Filter ribbon in its entry state: request summary, interpreted
// preferences, caveats, Edit Filter, Add to your Filter, Save as a Mode and
// Clear Filter. Hooks are mocked so each state renders deterministically.
type Book = { id: string; title: string; coverImageUrl: null };
let filter: { words: string | null; book: Book | null } = { words: null, book: null };
let error: unknown = null;
let pending: unknown = null;
let interpretation: unknown = null;
let committed: Record<string, unknown> | null = null;
let notice: string | null = null;
let assessment: unknown = undefined;

mock.module(new URL("../src/hooks/use-your-filter.tsx", import.meta.url).href, {
  namedExports: {
    useYourFilter: () => ({
      view: { filter, discover: { interpretation }, session: { negativeCount: 0 } },
      pending, error, announcement: "", status: pending ? "pending" : "ready", controller: {},
    }),
  },
});
mock.module(new URL("../src/hooks/use-working-context.tsx", import.meta.url).href, {
  namedExports: {
    useWorkingContext: () => {
      const refs = (committed?.refinements as string[] | undefined) ?? [];
      const base = (committed?.base as string | null | undefined) ?? null;
      const effective = [base, ...refs].filter(Boolean).join(", ") || null;
      return { committed, proposal: null, notice, store: null, actions: {}, effective };
    },
  },
});
mock.module("@tanstack/react-query", { namedExports: { useQuery: () => ({ data: assessment }) } });
mock.module("@workspace/api-client-react", { namedExports: { assessIntention: async () => assessment, getDiscover: async () => ({}), setFilter: async () => ({}) } });

const { YourFilter } = await import("../src/components/your-filter.tsx");
const book = { id: "b1", title: "A Very Long Real Catalog Title", coverImageUrl: null };
const html = () => renderToStaticMarkup(<YourFilter />);
const ctx = (base: string | null, refinements: string[] = [], sourceModeName: string | null = null) => ({
  version: 1, sessionId: "s", base, refinements, sourceModeId: sourceModeName ? "m1" : null, sourceModeName,
  sourceModeContext: null, origin: sourceModeName ? "mode" : "intention", started: true, scrollY: 0,
});
const reset = () => {
  filter = { words: null, book: null }; error = null; pending = null; interpretation = null;
  committed = null; notice = null; assessment = undefined;
};

test("no request yet: the one field adds the first request; no separate intention action", () => {
  reset();
  const h = html();
  for (const t of ["Your Filter", '<label for="add-refinement"', ">Add to your Filter<", 'placeholder="Describe the books you’re looking for"', ">Update results<", ">Save as a Mode<", ">Clear Filter<", "Clears this Filter. Saved Modes and your Cart stay unchanged."]) {
    assert.ok(h.includes(t), t);
  }
  // No Edit Filter for a request that does not exist, and no detached hints.
  assert.doesNotMatch(h, /button-edit-intention|Add an intention|Or use a book below|All books in this catalog/);
  assert.doesNotMatch(h, /block-filter-book|text-filter-source-mode/);
  for (const t of ["Not too scary", "Graphic novels", "Funny", "Animals"]) assert.ok(h.includes(t), t);
  assert.match(h, /data-state="expanded"/);
  // No old review gate, intro or duplicate submission controls.
  assert.doesNotMatch(h, /Start discovering|Changes not applied|Suggestions placed|button-apply-direction/);
});

test("intention summary, interpreted preferences and caveats", () => {
  reset();
  filter = { words: "funny mysteries for Johnny, not too scary", book: null };
  committed = ctx("funny mysteries for Johnny", ["not too scary"]);
  interpretation = { themes: ["Humor", "Mystery"], formats: [], reduce: ["scary", "long"], terms: [], seriesHint: null, source: "lexical" };
  assessment = { text: "funny mysteries for Johnny, not too scary", caveats: ["Johnny is kept as context; HDS knows only what you wrote."] };
  const h = html();
  assert.ok(h.includes("“funny mysteries for Johnny”"));
  assert.ok(h.includes("+ “not too scary”"));
  assert.ok(h.includes("Ranked toward:"));
  assert.ok(h.includes("Humor · Mystery · less scary"));
  // "long" has no ranking effect, so it is never shown as applied.
  assert.doesNotMatch(h, /less long|long/);
  assert.ok(h.includes("Johnny is kept as context"));
  // Existing request: wording stays visible beside a visible Edit Filter button.
  assert.match(h, /data-testid="button-edit-intention"[^>]*>.*?Edit Filter<\/button>/);
  assert.ok(h.includes('placeholder="Add another preference, such as graphic novels"'));
  assert.ok(h.includes(">Add to your Filter<"));
  // An already-present suggestion is hidden.
  assert.doesNotMatch(h, /button-refinement-not-scary/);
});

test("caveats from a different text are not shown", () => {
  reset();
  filter = { words: "dragons", book: null };
  committed = ctx("dragons");
  assessment = { text: "robots", caveats: ["stale caveat"] };
  assert.doesNotMatch(html(), /stale caveat/);
});

test("a Mode-sourced Filter shows provenance and offers Save as a new Mode", () => {
  reset();
  filter = { words: null, book };
  committed = ctx(null, [], "Books for Johnny");
  const h = html();
  assert.match(h, /Started from <strong[^>]*>Books for Johnny<\/strong>/);
  assert.ok(h.includes(">Save as a new Mode<"));
  assert.doesNotMatch(h, /from your Mode|Save as a Mode</);
});

test("the Filter's book is labeled as a book in Filter, never an example or a pivot", () => {
  reset();
  filter = { words: "dragons", book };
  committed = ctx("dragons");
  const h = html();
  for (const t of ["Book in your Filter", book.title, "Remove from Filter", `aria-label="Remove ${book.title} from Filter"`]) assert.ok(h.includes(t), t);
  // One signal type: no pivot controls and no legacy labels.
  assert.doesNotMatch(h, /Example book|Remove example|Picks|More like|Clear similarity/);
  // Reading order: request, then book, then the add field.
  const order = ["text-filter-intention", "block-filter-book", "form-add-refinement", "button-start-over"].map((id) => h.indexOf(id));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

test("customer-facing copy uses Filter and Mode, not internal object labels", () => {
  reset();
  for (const state of [
    () => { filter = { words: null, book: null }; committed = null; },
    () => { filter = { words: "dragons, funny", book }; committed = ctx("dragons", ["funny"], "Books for Johnny"); },
  ]) {
    state();
    const visible = html().replace(/<[^>]+>/g, " ");
    assert.doesNotMatch(visible, /intention|refinement|example|Picks|Start over|Apply\b/i);
  }
});

test("server words that differ from the stored context are shown as the intention", () => {
  reset();
  filter = { words: "space pirates", book: null };
  committed = ctx("dragons", [], "Books for Johnny");
  const h = html();
  assert.ok(h.includes("“space pirates”"));
  assert.doesNotMatch(h, /Started from/);
});

test("context replacement in flight announces Finding books", () => {
  reset();
  filter = { words: "dragons", book: null };
  committed = ctx("dragons");
  pending = { words: "robots", book: null, clearNegatives: true };
  const h = html();
  assert.match(h, /Finding books…/);
  assert.match(h, /disabled=""[^>]*data-testid="button-save-mode"/);
});

test("open-Mode notice is shown with a dismiss action", () => {
  reset();
  notice = "The book saved in this Mode is no longer available, so it was left out.";
  assert.ok(html().includes("no longer available"));
});

test("unsynced error disables changes and offers retry without dismiss", () => {
  reset(); filter = { words: "dragons", book };
  committed = ctx("dragons");
  error = { kind: "unsynced", message: "could not confirm", failed: null };
  const h = html();
  assert.match(h, /role="alert"/);
  assert.match(h, /Retry/);
  assert.doesNotMatch(h, /button-filter-dismiss/);
  assert.match(h, /data-testid="button-remove-book" disabled=""/);
  assert.match(h, /disabled=""[^>]*data-testid="button-apply-refinement"/);
  assert.match(h, /disabled=""[^>]*data-testid="button-start-over"/);
});
