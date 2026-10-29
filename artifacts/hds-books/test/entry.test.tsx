import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HOME_EXAMPLES,
  REFINEMENT_SUGGESTIONS,
  assessmentOutcome,
  composeQuery,
  preferenceLabels,
  refinementOutcome,
  suggestModeName,
  validateModeName,
  visibleSuggestions,
} from "../src/lib/intention.ts";
import { ModeRepository, MODES_STORAGE_KEY, copyMode, modeSummary } from "../src/lib/modes.ts";
import { WorkingContextStore, WORKING_CONTEXT_KEY } from "../src/lib/working-context.ts";
import { FilterController } from "../src/lib/filter-controller.ts";
import type { FilterInput, FilterResult } from "../src/lib/filter-controller.ts";
import { contextSummary } from "../src/lib/context-summary.ts";

type Assessment = Parameters<typeof assessmentOutcome>[0];
const a = (patch: Partial<Assessment>): Assessment => ({
  text: "x", status: "supported", unsupportedCategories: [], supportedText: "x", mismatch: null, caveats: [], actionable: true, ...patch,
});

class MemoryStorage {
  data = new Map<string, string>();
  failWrites = false;
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { if (this.failWrites) throw new Error("quota"); this.data.set(key, value); }
}

const JOHNNY = { name: "Books for Johnny", baseIntention: null, refinements: [], context: { modeId: "johnny", label: "Book for Johnny · age 10" }, selectedProductIds: [] };
let ids = 0;
const repo = (storage: MemoryStorage | null) => new ModeRepository(storage, () => new Date("2026-10-20T00:00:00Z"), () => `m${++ids}`);

// --- Entry copy and composition ---

test("examples and refinement suggestions match the verified server vocabulary", () => {
  // Kept in step with artifacts/api-server/test/assessment.test.ts.
  assert.deepEqual([...HOME_EXAMPLES], ["Funny graphic novels", "Animal adventures", "Mysteries that aren’t too scary"]);
  assert.deepEqual(REFINEMENT_SUGGESTIONS.map((s) => s.text), ["not too scary", "graphic novels", "funny", "animals"]);
  assert.deepEqual(visibleSuggestions("Funny mysteries, not too scary").map((s) => s.id), ["graphic", "animals"]);
});

test("effective query = base intention + refinements, additive", () => {
  assert.equal(composeQuery("funny mysteries.", ["not too scary", "  animals "]), "funny mysteries, not too scary, animals");
  assert.equal(composeQuery(null, []), null);
  assert.equal(composeQuery(null, ["graphic novels"]), "graphic novels");
});

test("assessment outcomes use the specified copy and never proceed for unsupported input", () => {
  assert.deepEqual(assessmentOutcome(a({ status: "empty", text: "" })), { kind: "blocked", message: "Describe what you’re looking for, or browse all books.", offerBrowse: true });
  assert.deepEqual(assessmentOutcome(a({ text: "dragons" })), { kind: "proceed", text: "dragons" });
  const grocery = assessmentOutcome(a({ status: "unsupported", unsupportedCategories: [{ key: "grocery", label: "Grocery", plural: "groceries" }], supportedText: null }));
  assert.equal(grocery.kind, "blocked");
  assert.equal(grocery.kind === "blocked" && grocery.message, "Grocery discovery isn’t available yet. This prototype currently supports books.");
  assert.equal(grocery.kind === "blocked" && grocery.continueText, undefined);
  const mixed = assessmentOutcome(a({ status: "mixed", unsupportedCategories: [{ key: "toys", label: "Toy", plural: "toys" }], supportedText: "books for Johnny" }));
  assert.equal(mixed.kind === "blocked" && mixed.message, "We can explore books, but toys aren’t available here yet.");
  assert.equal(mixed.kind === "blocked" && mixed.continueLabel, "Continue with books");
  assert.equal(mixed.kind === "blocked" && mixed.continueText, "books for Johnny");
  const unknown = assessmentOutcome(a({ status: "uninterpretable", actionable: false }));
  assert.equal(unknown.kind === "blocked" && unknown.message, "We couldn’t interpret your request. Your text is still here.");
  const mismatch = assessmentOutcome(a({ status: "mismatch", caveats: ["Books here are labeled grades 4–5 (about age 10), not chosen for age 3."] }));
  assert.equal(mismatch.kind === "blocked" && mismatch.continueLabel, "Continue with available books");
});

test("refinements are applied only when the engine can use them", () => {
  assert.deepEqual(refinementOutcome(a({ text: "funny" })), { apply: true });
  const unsupported = refinementOutcome(a({ text: "and a toy", status: "mixed", unsupportedCategories: [{ key: "toys", label: "Toy", plural: "toys" }] }));
  assert.equal(unsupported.apply, false);
  assert.match(!unsupported.apply ? unsupported.message : "", /wasn’t applied/);
  const price = refinementOutcome(a({ text: "under $10", actionable: false, caveats: ["Price limits aren’t applied; results are not filtered by price."] }));
  assert.equal(price.apply, false);
  assert.match(!price.apply ? price.message : "", /Price limits aren’t applied.*“under \$10” wasn’t applied/);
});

test("preference labels list only soft preferences with ranking effect", () => {
  assert.deepEqual(preferenceLabels({ themes: ["Humor"], formats: ["Graphic Novel"], reduce: ["scary", "long"], terms: [], seriesHint: null, source: "lexical" } as never), ["Humor", "Graphic Novel", "less scary"]);
  assert.deepEqual(preferenceLabels(null), []);
});

test("suggested Mode names are deterministic and grounded", () => {
  assert.equal(suggestModeName({ base: "funny mysteries for Johnny", refinements: ["not too scary"], bookTitle: null, sourceModeName: null }), "Funny mysteries for Johnny");
  assert.equal(suggestModeName({ base: null, refinements: [], bookTitle: "Wonder (Paperback)", sourceModeName: null }), "More like Wonder");
  assert.equal(suggestModeName({ base: null, refinements: [], bookTitle: null, sourceModeName: "Books for Johnny" }), "Books for Johnny");
  assert.equal(suggestModeName({ base: null, refinements: [], bookTitle: null, sourceModeName: null }), "My book discovery");
  const long = suggestModeName({ base: "a very long intention about dragons and wizards and castles in faraway lands", refinements: [], bookTitle: null, sourceModeName: null });
  assert.ok(long.length <= 48 && !long.endsWith(" "));
  assert.deepEqual(validateModeName("   "), { ok: false, message: "Enter a name for this Mode." });
  assert.equal(validateModeName("x".repeat(61)).ok, false);
  assert.deepEqual(validateModeName("  My   Mode "), { ok: true, name: "My Mode" });
});

// --- Mode repository ---

test("demo Mode is seeded exactly once, from real mode context, with no invented words", () => {
  const storage = new MemoryStorage();
  const r = repo(storage);
  r.ensureSeeded(JOHNNY);
  r.ensureSeeded(JOHNNY);
  assert.equal(r.getSnapshot().modes.length, 1);
  const seeded = r.getSnapshot().modes[0];
  assert.equal(seeded.baseIntention, null);
  assert.deepEqual(seeded.refinements, []);
  // A new repository over the same storage (refresh) never re-seeds.
  const again = repo(storage);
  again.ensureSeeded(JOHNNY);
  assert.equal(again.getSnapshot().modes.length, 1);
  // Even an emptied list stays unseeded once the flag is set.
  storage.setItem(MODES_STORAGE_KEY, JSON.stringify({ version: 1, seeded: true, modes: [] }));
  const emptied = repo(storage);
  emptied.ensureSeeded(JOHNNY);
  assert.equal(emptied.getSnapshot().modes.length, 0);
});

test("saving creates independent copies that survive refresh", () => {
  const storage = new MemoryStorage();
  const r = repo(storage);
  const refinements = ["not too scary"];
  const saved = r.save({ name: "Mysteries", baseIntention: "funny mysteries", refinements, context: null, selectedProductIds: ["b1", "b2"] });
  assert.ok(saved.ok);
  refinements.push("mutated");
  const again = repo(storage).getSnapshot().modes;
  assert.equal(again.length, 1);
  assert.deepEqual(again[0].refinements, ["not too scary"]);
  assert.deepEqual(again[0].selectedProductIds, ["b1"]); // 0–1 example book
  // Same name again is a new Mode, never an overwrite.
  r.save({ name: "Mysteries", baseIntention: null, refinements: [], context: null, selectedProductIds: [] });
  assert.equal(repo(storage).getSnapshot().modes.length, 2);
  // Copies handed out cannot mutate the saved Mode.
  const copy = copyMode(again[0]);
  copy.refinements.push("x");
  assert.deepEqual(repo(storage).getSnapshot().modes[0].refinements, ["not too scary"]);
  assert.equal(modeSummary(again[0]), "“funny mysteries” + “not too scary” · 1 book in Filter");
  // Stored recipient context reads as "Age 10 · Books" without restating the Mode name.
  assert.equal(modeSummary({ ...again[0], baseIntention: null, refinements: [], selectedProductIds: [], context: { modeId: "johnny", label: "Book for Johnny · age 10" } }), "Age 10 · Books");
});

test("corrupt storage is set aside safely and not re-seeded", () => {
  const storage = new MemoryStorage();
  storage.setItem(MODES_STORAGE_KEY, "{not json");
  const r = repo(storage);
  assert.deepEqual(r.getSnapshot().modes, []);
  assert.match(r.getSnapshot().notice ?? "", /set aside/);
  assert.equal(storage.getItem(`${MODES_STORAGE_KEY}.unreadable`), "{not json");
  r.ensureSeeded(JOHNNY);
  assert.equal(r.getSnapshot().modes.length, 0);
  // Invalid entries are skipped, valid ones kept.
  storage.setItem(MODES_STORAGE_KEY, JSON.stringify({ version: 1, seeded: true, modes: [{ id: 3 }, { ...JOHNNY, id: "ok", schemaVersion: 1, createdAt: "2026-01-01T00:00:00Z" }] }));
  const partial = repo(storage).getSnapshot();
  assert.deepEqual(partial.modes.map((m) => m.id), ["ok"]);
  assert.match(partial.notice ?? "", /left out/);
});

test("newer-version data is never overwritten; write failures keep state", () => {
  const storage = new MemoryStorage();
  storage.setItem(MODES_STORAGE_KEY, JSON.stringify({ version: 9, modes: [] }));
  const newer = repo(storage);
  assert.equal(newer.getSnapshot().writable, false);
  assert.equal(newer.save({ ...JOHNNY, name: "x" }).ok, false);
  assert.equal(JSON.parse(storage.getItem(MODES_STORAGE_KEY)!).version, 9);

  const failing = new MemoryStorage();
  const r = repo(failing);
  failing.failWrites = true;
  const result = r.save({ ...JOHNNY, name: "x" });
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.message : "", /couldn’t be saved/);
  assert.equal(r.getSnapshot().modes.length, 0);

  const none = repo(null);
  assert.equal(none.save({ ...JOHNNY, name: "x" }).ok, false);
});

// --- Working context ---

const filter = (words: string | null, id: string | null = null): FilterInput => ({ words, book: id ? { id, title: id, coverImageUrl: null } : null });

test("a proposal is adopted only by results with matching words and example", () => {
  const storage = new MemoryStorage();
  const store = new WorkingContextStore(storage, "s1");
  store.observe(filter(null));
  store.propose({ base: "funny mysteries", refinements: [], sourceModeId: "m1", sourceModeName: "Mine", sourceModeContext: null, origin: "mode", bookId: "b1", replace: true });
  // Older results (stale) do not adopt the newer context.
  store.observe(filter("funny mysteries", null));
  assert.equal(store.getSnapshot().committed?.sourceModeName ?? null, null);
  store.observe(filter("funny mysteries", "b1"));
  const ctx = store.getSnapshot().committed!;
  assert.equal(ctx.sourceModeName, "Mine");
  assert.equal(ctx.started, true);
  assert.equal(store.getSnapshot().proposal, null);
  // Persisted per session; other sessions ignore it.
  assert.equal(new WorkingContextStore(storage, "s1").getSnapshot().committed?.base, "funny mysteries");
  assert.equal(new WorkingContextStore(storage, "other").getSnapshot().committed, null);
});

test("refinements build on the base; unknown server words become the base without Mode provenance", () => {
  const store = new WorkingContextStore(new MemoryStorage(), "s1");
  store.propose({ base: "dragons", refinements: [], sourceModeId: "m1", sourceModeName: "Mine", sourceModeContext: null, origin: "mode", replace: true });
  store.observe(filter("dragons"));
  store.propose({ base: "dragons", refinements: ["funny"], sourceModeId: "m1", sourceModeName: "Mine", sourceModeContext: null, origin: "mode", replace: false });
  store.observe(filter("dragons, funny"));
  assert.deepEqual(store.getSnapshot().committed?.refinements, ["funny"]);
  assert.equal(store.getSnapshot().committed?.sourceModeName, "Mine");
  store.observe(filter("space pirates"));
  const ctx = store.getSnapshot().committed!;
  assert.equal(ctx.base, "space pirates");
  assert.deepEqual(ctx.refinements, []);
  assert.equal(ctx.sourceModeName, null);
});

test("an edit that resolves to the current words is adopted immediately", () => {
  const store = new WorkingContextStore(new MemoryStorage(), "s1");
  store.observe(filter("dragons"));
  store.propose({ base: "dragons", refinements: [], sourceModeId: null, sourceModeName: null, sourceModeContext: null, origin: "intention", replace: false });
  assert.equal(store.getSnapshot().proposal, null);
  assert.equal(store.getSnapshot().committed?.origin, "intention");
});

test("scroll position survives navigation and resets for a new context", () => {
  const storage = new MemoryStorage();
  const store = new WorkingContextStore(storage, "s1");
  store.observe(filter("dragons"));
  store.rememberScroll(1234.4);
  store.persist();
  assert.equal(new WorkingContextStore(storage, "s1").getSnapshot().committed?.scrollY, 1234);
  store.propose({ base: null, refinements: [], sourceModeId: null, sourceModeName: null, sourceModeContext: null, origin: "browse", replace: true });
  store.observe(filter(null));
  assert.equal(store.getSnapshot().committed?.scrollY, 0);
  assert.ok(JSON.parse(storage.getItem(WORKING_CONTEXT_KEY)!).started);
});

test("corrupt working-context storage is ignored", () => {
  const storage = new MemoryStorage();
  storage.setItem(WORKING_CONTEXT_KEY, "{oops");
  assert.equal(new WorkingContextStore(storage, "s1").getSnapshot().committed, null);
});

test("Continue discovering summary is factual", () => {
  const store = new WorkingContextStore(new MemoryStorage(), "s1");
  store.propose({ base: "dragons", refinements: ["funny"], sourceModeId: "m", sourceModeName: "Mine", sourceModeContext: null, origin: "mode", replace: true });
  store.observe(filter("dragons, funny", "Wonder (Paperback)"));
  assert.equal(contextSummary(store.getSnapshot().committed, filter("dragons, funny", "Wonder (Paperback)"), 2),
    "Started from Mine · “dragons, funny” · In Filter: Wonder · 2 fewer like this");
  assert.equal(contextSummary(null, filter(null)), "All books");
});

// --- Atomic context replacement through the existing controller ---

function result(words: string | null, book: { id: string; title: string; coverImageUrl: null } | null): FilterResult {
  const shaping = { modeLabel: "m", query: words, pivot: book, picks: [], negatives: [], hasSignals: !!(words || book), signalCount: 0, summaryText: "" };
  const session = { sessionId: "s", modeId: "m", modeLabel: "m", gradeLabel: "g", pickCount: 0, cartCount: 3, negativeCount: 0, shaping, rankingVersion: 1 };
  const discover = { heading: "", results: [], resultCount: 0, totalAvailable: 0, hasMore: false, personalized: false, relaxed: false, shaping, rankingVersion: 1, session };
  return { session, discover } as unknown as FilterResult;
}
const tick = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

test("replace commits words, example and negative clearing together, even for identical inputs", async () => {
  const sent: FilterInput[] = [];
  const c = new FilterController({
    read: async () => result(null, null),
    commit: async (desired) => { sent.push(desired); return result(desired.words, desired.book); },
  });
  await c.load();
  c.replace({ words: null, book: null });
  await tick();
  assert.equal(sent.length, 1, "Start over on an empty Filter still clears negatives");
  assert.equal(sent[0].clearNegatives, true);
  c.replace({ words: "dragons", book: { id: "b", title: "B", coverImageUrl: null } });
  await tick();
  assert.deepEqual({ ...sent[1] }, { words: "dragons", book: { id: "b", title: "B", coverImageUrl: null }, clearNegatives: true });
  // Edits and refinements never clear negatives.
  c.setWords("dragons, funny");
  await tick();
  assert.equal(sent[2].clearNegatives, undefined);
  assert.equal(sent[2].book?.id, "b");
});

test("a failed replacement keeps the previous context; the newest request wins", async () => {
  let fail = true;
  const c = new FilterController({
    read: async () => result("old", null),
    commit: async (desired) => { if (fail) throw Object.assign(new Error("x"), { status: 500 }); return result(desired.words, desired.book); },
  });
  await c.load();
  c.replace({ words: "new", book: null });
  await tick();
  assert.equal(c.getSnapshot().view?.filter.words, "old");
  assert.equal(c.getSnapshot().error?.kind, "update");
  fail = false;
  c.replace({ words: "first", book: null });
  c.replace({ words: "second", book: null });
  await tick();
  assert.equal(c.getSnapshot().view?.filter.words, "second");
});

// --- Home prepare-then-commit entry ---

import { HomeEntry } from "../src/lib/home-entry.ts";

function entryHarness(classify: (text: string) => Partial<Assessment>) {
  const committed: string[] = [];
  const pending: Array<{ text: string; resolve: () => void }> = [];
  const entry = new HomeEntry({
    assess: (text) => new Promise((resolve) => pending.push({ text, resolve: () => resolve(a({ text, ...classify(text) })) })),
    commit: (text) => committed.push(text),
    onChange: () => {},
  });
  return { entry, committed, pending };
}

test("Home: a mixed category-plus-age request is reassessed before continuing", async () => {
  const { entry, committed, pending } = entryHarness((text) => text === "books for toddlers and toys"
    ? { status: "mixed", unsupportedCategories: [{ key: "toys", label: "Toy", plural: "toys" }], supportedText: "books for toddlers" }
    : { status: "mismatch", caveats: ["Books here are labeled grades 4–5 (about age 10), not chosen for toddlers."] });
  const first = entry.submit("books for toddlers and toys");
  pending.shift()!.resolve(); await first;
  const mixed = entry.snapshot.notice!;
  assert.equal(mixed.continueLabel, "Continue with books");
  const cont = entry.continueWith(mixed);
  assert.equal(pending[0].text, "books for toddlers");
  pending.shift()!.resolve(); await cont;
  assert.deepEqual(committed, [], "the narrowed text still mismatches; nothing is committed");
  assert.equal(entry.snapshot.notice?.continueLabel, "Continue with available books");
  await entry.continueWith(entry.snapshot.notice!);
  assert.deepEqual(committed, ["books for toddlers"], "only the explicit acknowledgement commits");
});

test("Home: Browse all books or Open Mode retires an assessment in flight", async () => {
  const { entry, committed, pending } = entryHarness(() => ({ status: "supported" }));
  const submission = entry.submit("dragons");
  assert.equal(entry.snapshot.busy, true);
  entry.cancel(); // Browse all books / Open Mode / typing
  assert.equal(entry.snapshot.busy, false);
  pending.shift()!.resolve(); await submission;
  assert.deepEqual(committed, [], "a late response never commits over the newer choice");
});

test("Home: one submission at a time; empty input never assesses", async () => {
  const { entry, committed, pending } = entryHarness(() => ({ status: "supported" }));
  await entry.submit("   ");
  assert.equal(pending.length, 0);
  assert.match(entry.snapshot.notice?.message ?? "", /browse all books/);
  const first = entry.submit("dragons");
  void entry.submit("dragons");
  assert.equal(pending.length, 1);
  pending.shift()!.resolve(); await first;
  assert.deepEqual(committed, ["dragons"]);
});
