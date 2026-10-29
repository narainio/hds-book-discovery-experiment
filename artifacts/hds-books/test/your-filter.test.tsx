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

test("caveats from a different text are not shown", () => {
  reset();
  filter = { words: "dragons", book: null };
  committed = ctx("dragons");
  assessment = { text: "robots", caveats: ["stale caveat"] };
  assert.doesNotMatch(html(), /stale caveat/);
});

test("customer-facing copy uses Filter and Mode, not internal object labels", () => {
  reset();
  for (const state of [
    () => { filter = { words: null, book: null }; committed = null; },
    () => { filter = { words: "dragons, funny", book }; committed = ctx("dragons", ["funny"], "Books for Johnny"); },
  ]) {
    state();
    const visible = html().replace(/<[^>]+>/g, " ");
    assert.doesNotMatch(visible, /intention|refinement|example|Picks|Start over|Apply\b|\bModes?\b/i);
  }
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

test("empty Filter: heading, fixed Books qualifier, empty slots and one replace field", () => {
  reset();
  const h = html();
  for (const t of [">Filter</h2>", "Books", "(product type)", "Add a few words to shape this filter", "Add one book to this filter",
    '<label for="add-refinement"', "Change what you’re looking for", 'placeholder="For example, books to be read by an older sister"',
    'aria-label="Update results"', ">Save this filter<", ">Clear Filter<", "Clears this filter. Saved filters and your Cart stay unchanged."]) {
    assert.ok(h.includes(t), t);
  }
  assert.doesNotMatch(h, /age appropriate|gender|Male|button-edit-intention|Edit Filter|Your Filter|Add to your Filter/);
  for (const t of ["Not too scary", "Graphic novels", "Funny", "Animals"]) assert.ok(h.includes(t), t);
  assert.match(h, /data-state="expanded"/);
  // Fixed qualifiers have no remove control.
  const q = h.slice(h.indexOf("list-filter-qualifiers"), h.indexOf("</ul>", h.indexOf("list-filter-qualifiers")));
  assert.doesNotMatch(q, /<button/);
});

test("filled text slot shows the short label, full text for screen readers, and Remove words", () => {
  reset();
  filter = { words: "Books to be read by older sister", book: null };
  committed = ctx("Books to be read by older sister");
  interpretation = { themes: ["Humor", "Mystery"], formats: [], reduce: ["scary", "long"], terms: [], seriesHint: null, source: "lexical" };
  assessment = { text: "Books to be read by older sister", caveats: ["Johnny is kept as context; HDS knows only what you wrote."] };
  const h = html();
  assert.match(h, /title="Books to be read by older sister"[^>]*><span aria-hidden="true">Read by older sister<\/span><span class="sr-only">Words: Books to be read by older sister/);
  assert.ok(h.includes('aria-label="Remove words"'));
  assert.ok(h.includes("Ranked toward:"));
  assert.ok(h.includes("Humor · Mystery · less scary"));
  assert.doesNotMatch(h, /less long/);
  assert.ok(h.includes("Johnny is kept as context"));
  assert.doesNotMatch(h, /button-edit-intention/);
});

test("saved-filter Filter: Filter – name heading, age qualifier from its context, Save as a new filter", () => {
  reset();
  filter = { words: null, book };
  committed = { ...ctx(null, [], "Books for Johnny"), sourceModeContext: { modeId: "johnny", label: "Book for Johnny · age 10" } };
  const h = html();
  assert.ok(h.includes("Filter – Books for Johnny</h2>"));
  assert.match(h, /data-testid="text-qualifier-age">10/);
  assert.ok(h.includes("(age appropriate)"));
  assert.ok(h.includes(">Save as a new filter<"));
  assert.doesNotMatch(h, /Save this filter<|Mode/);
});

test("no age qualifier for a Filter started from Ask anything", () => {
  reset();
  filter = { words: "age 10 dragons", book: null };
  committed = ctx("age 10 dragons");
  assert.doesNotMatch(html(), /age appropriate/);
});

test("the Filter's one book is a large thumbnail with Remove from Filter", () => {
  reset();
  filter = { words: "dragons", book };
  committed = ctx("dragons");
  const h = html();
  for (const t of [book.title, "Remove from Filter", `aria-label="Remove ${book.title} from Filter"`]) assert.ok(h.includes(t), t);
  assert.doesNotMatch(h, /Example book|Remove example|Picks|More like|Clear similarity|Add one book to this filter/);
  const order = ["slot-filter-text", "form-add-refinement", "block-filter-book", "button-start-over"].map((id) => h.indexOf(id));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

test("server words that differ from the stored context are shown, without the saved name", () => {
  reset();
  filter = { words: "space pirates", book: null };
  committed = ctx("dragons", [], "Books for Johnny");
  const h = html();
  assert.ok(h.includes("Space pirates"));
  assert.doesNotMatch(h, /Filter – Books for Johnny/);
});
