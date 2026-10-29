import assert from "node:assert/strict";
import { mock, test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

let view: unknown = null;
let committed: unknown = null;
let modes: unknown[] = [];
let modesNotice: string | null = null;
const toasts: unknown[] = [];

mock.module("wouter", {
  namedExports: {
    Link: ({ children, href, ...rest }: React.PropsWithChildren<{ href: string }>) => React.createElement("a", { href, ...rest }, children),
    useLocation: () => ["/", () => {}],
  },
});
mock.module("@workspace/api-client-react", { namedExports: { assessIntention: async () => ({}) } });
mock.module(new URL("../src/hooks/use-toast.ts", import.meta.url).href, {
  namedExports: { toast: (t: unknown) => { toasts.push(t); }, useToast: () => ({ toasts: [] }) },
});
mock.module(new URL("../src/hooks/use-your-filter.tsx", import.meta.url).href, {
  namedExports: { useYourFilter: () => ({ view }) },
});
mock.module(new URL("../src/hooks/use-working-context.tsx", import.meta.url).href, {
  namedExports: {
    useWorkingContext: () => ({ committed, actions: {} }),
    useModes: () => ({ modes, notice: modesNotice, writable: true }),
  },
});

const { default: Landing } = await import("../src/pages/landing.tsx");
const { default: MyThings } = await import("../src/pages/my-things.tsx");
const { ComingSoonButton, comingSoonMessage } = await import("../src/components/coming-soon.tsx");
const landing = () => renderToStaticMarkup(<Landing />);
const things = () => renderToStaticMarkup(<MyThings />);

test("Landing: greeting, labeled Ask anything box, scope note, featured cards and tiles", () => {
  const h = landing();
  assert.match(h.replace(/<!-- -->/g, ""), /<h1[^>]*>Good (morning|afternoon|evening), Catherine\.<\/h1>/);
  for (const t of ['<label for="home-intention"', ">Ask anything<", 'placeholder="Ask anything…"', "Currently exploring books.",
    "My Pizza", "Create my pizza", "Premium backpack for class", "Explore",
    "Seasonal produce", "Healthy meals", "Activewear", "Household goods", "Electronics", "Brand store"]) assert.ok(h.includes(t), t);
  assert.doesNotMatch(h, /Samsung|Books for Johnny/);
  // Images use the base URL path; featured cards carry alt text, tiles alt="".
  assert.match(h, /src="\/landing\/pizza\.webp" alt="A stone-baked pizza/);
  assert.match(h, /src="\/landing\/earbuds\.webp" alt=""/);
  // Placeholders are real buttons using the shared coming-soon pattern.
  assert.equal((h.match(/data-coming-soon=""/g) ?? []).length, 2 + 2 + 5);
});

test("My things: heading, real filters first, placeholders without Open", () => {
  view = null; committed = null; modesNotice = null;
  modes = [{ id: "m1", schemaVersion: 1, name: "Books for Johnny", baseIntention: null, refinements: [], context: { modeId: "johnny", label: "Book for Johnny · age 10" }, selectedProductIds: [], createdAt: "2026-10-20T00:00:00Z" }];
  const h = things();
  assert.ok(h.includes(">My things</h1>"));
  for (const t of ["My filters", "My personal SKUs", "My lists", "Organic strawberries", "Back to school"]) assert.ok(h.includes(t), t);
  assert.ok(h.indexOf("Filter – Books for Johnny") < h.indexOf("Filter – Weeknight dinners"));
  assert.ok(h.includes("Age 10 · Books"));
  const row = h.slice(h.indexOf('data-testid="row-mode-m1"'), h.indexOf("</li>", h.indexOf('data-testid="row-mode-m1"')));
  assert.equal((row.match(/<button/g) ?? []).length, 1);
  assert.match(row, /Open/);
  const ph = h.slice(h.indexOf('button-placeholder-filter-0'), h.indexOf("</li>", h.indexOf('button-placeholder-filter-0')));
  assert.match(ph, /Coming soon/);
  assert.doesNotMatch(ph, /Open/);
  assert.doesNotMatch(h, /Continue discovering|\bMode\b/);
});

test("My things: empty filters copy", () => {
  modes = [];
  const h = things();
  assert.ok(h.includes("No saved filters yet."));
  assert.ok(h.includes("You can save a filter while discovering."));
});

test("My things: Continue discovering only when it resumes something", () => {
  view = { filter: { words: "dragons", book: null }, session: { negativeCount: 1 } };
  committed = { version: 1, sessionId: "s", base: "dragons", refinements: [], sourceModeId: null, sourceModeName: null, sourceModeContext: null, origin: "intention", started: true, scrollY: 0 };
  const h = things();
  assert.match(h, /href="\/discover"/);
  assert.ok(h.includes("“dragons” · 1 fewer like this"));
  assert.ok(h.indexOf("Continue discovering") < h.indexOf("My filters"));
  view = { filter: { words: null, book: null }, session: { negativeCount: 0 } };
  committed = { ...(committed as object), base: null, origin: "browse" };
  assert.doesNotMatch(things(), /Continue discovering/);
});

test("Coming soon: a click shows the toast and does not navigate", () => {
  toasts.length = 0;
  let prevented = false;
  // forwardRef renders a <button type="button"> (never a link) whose click calls preventDefault + toast.
  const rendered = (ComingSoonButton as unknown as { render: (p: unknown, r: unknown) => React.ReactElement<{ type: string; onClick: (e: unknown) => void }> }).render({ feature: "Scheduling" }, null);
  assert.equal(rendered.type, "button");
  assert.equal(rendered.props.type, "button");
  rendered.props.onClick({ preventDefault: () => { prevented = true; } });
  assert.ok(prevented);
  assert.equal(toasts.length, 1);
  assert.deepEqual((toasts[0] as { description: string }).description, "Scheduling is coming soon in this demo.");
  assert.equal(comingSoonMessage("Create my pizza"), "Create my pizza is coming soon in this demo.");
});
