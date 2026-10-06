import assert from "node:assert/strict";
import test, { mock } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

let cartIds: string[] = [];

const book = {
  id: "mismatch-fixture",
  title: "A Fixture Book",
  author: "Catalog Author",
  illustrator: null,
  seriesName: null,
  description: "<p>Fixture description.</p>",
  coverImageUrl: null,
  hasCover: false,
  price: 11.99,
  catalogPrice: 14.99,
  currency: "USD",
  formatLabel: "Paperback",
  readingLevel: "Grades 4–5",
  publisher: "Fixture Press",
  publicationDate: null,
  availabilityLabel: "In stock",
  subjects: [],
  tags: [],
  displayTopics: ["Friendship", "Growing up"],
  subjectSummary: "A friendship story about navigating change while growing up.",
  editions: [{ binding: "Hardcover", price: 14.99 }],
  sourceUrl: null,
  whyItMaySuit: null,
};

const mutation = () => ({ mutate() {}, isPending: false });
const passthrough = ({ children }: React.PropsWithChildren) => children;

mock.module("wouter", {
  namedExports: {
    useRoute: () => [true, { id: book.id }],
    useLocation: () => ["/book/mismatch-fixture", () => {}],
    Link: ({ children, href }: React.PropsWithChildren<{ href: string }>) =>
      React.createElement("a", { href }, children),
  },
});
mock.module("@workspace/api-client-react", {
  namedExports: {
    useGetBook: () => ({ data: book, isLoading: false, error: null }),
    useAddNegative: mutation,
    useAddCartItem: mutation,
    useRecordEvent: mutation,
    getGetBookQueryKey: (id: string) => ["book", id],
  },
});
mock.module("@tanstack/react-query", {
  namedExports: { useQueryClient: () => ({}) },
});
mock.module("@radix-ui/react-dropdown-menu", {
  namedExports: {
    Root: passthrough,
    Trigger: passthrough,
    Portal: passthrough,
    Content: passthrough,
    Item: passthrough,
  },
});
mock.module(new URL("../src/hooks/use-session.tsx", import.meta.url).href, {
  namedExports: {
    useSession: () => ({
      sessionId: "fixture-session",
      session: { pickIds: [], cartIds },
    }),
  },
});
mock.module(new URL("../src/lib/discovery-cache.ts", import.meta.url).href, {
  namedExports: {
    setCartState() {},
    setSessionState() {},
  },
});

let activeBookId: string | null = null;
mock.module(new URL("../src/hooks/use-your-filter.tsx", import.meta.url).href, {
  namedExports: {
    useYourFilter: () => ({
      view: { filter: { words: null, book: activeBookId ? { id: activeBookId, title: "x", coverImageUrl: null } : null } },
      pending: null, error: null, controller: { setBook() {}, refresh() {} },
    }),
  },
});

const { default: ProductDetail } =
  await import("../src/pages/product-detail.tsx");

function commerceButtons(markup: string): string[] {
  return [...markup.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)]
    .map(([button]) => button)
    .filter((button) => /Add (?:another )?to cart/.test(button));
}

test("PDP renders the surfaced format instead of a mismatched edition binding", () => {
  const markup = renderToStaticMarkup(<ProductDetail />);

  assert.equal((markup.match(/Paperback/g) ?? []).length, 2);
  assert.doesNotMatch(markup, /Hardcover/);
});

test("desktop and mobile PDP CTAs omit price and reflect Cart state", () => {
  cartIds = [];
  const addButtons = commerceButtons(renderToStaticMarkup(<ProductDetail />));
  assert.equal(addButtons.length, 2);
  for (const button of addButtons) {
    assert.match(button, /Add to cart/);
    assert.doesNotMatch(button, /\$\d/);
  }

  cartIds = [book.id];
  const anotherButtons = commerceButtons(renderToStaticMarkup(<ProductDetail />));
  assert.equal(anotherButtons.length, 2);
  for (const button of anotherButtons) {
    assert.match(button, /Add another to cart/);
    assert.doesNotMatch(button, /\$\d/);
  }
});

test("PDP renders a summary, provenance, and plain-text Topics", () => {
  book.subjectSummary = "A friendship story about navigating change while growing up.";
  book.displayTopics = ["Friendship", "Growing up"];
  book.subjects = ["Family, Friends & School > Friendship > Making Friends"];

  const markup = renderToStaticMarkup(<ProductDetail />);
  assert.match(markup, />What it explores</);
  assert.match(markup, /A friendship story about navigating change while growing up\./);
  assert.match(markup, /HDS summary based on the book’s catalog information\./);
  assert.match(markup, />Topics</);
  assert.match(markup, /Friendship, Growing up/);
  assert.doesNotMatch(markup, /Family, Friends &amp; School/);
  assert.doesNotMatch(markup, />Subjects</);
});

test("PDP renders only Topics and no provenance when summary is absent", () => {
  book.subjectSummary = null;
  book.displayTopics = ["Mysteries", "Humor"];

  const markup = renderToStaticMarkup(<ProductDetail />);
  assert.match(markup, />Topics</);
  assert.match(markup, /Mysteries, Humor/);
  assert.doesNotMatch(markup, /What it explores/);
  assert.doesNotMatch(markup, /HDS summary based/);
  assert.doesNotMatch(markup, /spinner|coming soon|retry/i);
});

test("PDP omits the subject section when summary and Topics are absent", () => {
  book.subjectSummary = null;
  book.displayTopics = [];
  book.subjects = ["STEM > Math & Technology > Computers"];

  const markup = renderToStaticMarkup(<ProductDetail />);
  assert.doesNotMatch(markup, /What it explores|Topics|Topics unavailable|Subjects/);
  assert.doesNotMatch(markup, /STEM|Math &amp; Technology/);
});

test("What it explores remains distinct from deterministic suitability copy", () => {
  book.subjectSummary = "A mystery centered on friendship and a changing community.";
  book.displayTopics = ["Mysteries", "Friendship"];
  book.whyItMaySuit = "Its illustrated format and series context match the selected reading preferences.";

  const markup = renderToStaticMarkup(<ProductDetail />);
  assert.match(markup, /Why it may suit Johnny/);
  assert.match(markup, /Its illustrated format and series context/);
  assert.match(markup, /What it explores/);
  assert.match(markup, /A mystery centered on friendship/);
});

test("PDP offers the single example action, never legacy Filter picks", () => {
  activeBookId = null;
  let markup = renderToStaticMarkup(<ProductDetail />);
  assert.match(markup, /Use to shape results/);
  assert.doesNotMatch(markup, /Add to Filter|Remove from Filter|Show me more like this/);
  activeBookId = book.id;
  markup = renderToStaticMarkup(<ProductDetail />);
  assert.match(markup, /In Filter/);
  assert.match(markup, /aria-pressed="true"/);
  activeBookId = null;
});
