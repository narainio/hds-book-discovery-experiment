import assert from "node:assert/strict";
import test from "node:test";
import type { Session } from "@workspace/db";
import { assessIntention } from "../src/domain/assessment";
import { interpret } from "../src/domain/interpreter";
import { CURATED_PROMPTS } from "../src/domain/config";
import { catalog } from "../src/domain/catalog";
import { withNegativesCleared } from "../src/services/filter";

// Mirrors HOME_EXAMPLES and REFINEMENT_SUGGESTIONS in
// artifacts/hds-books/src/lib/intention.ts (asserted there too).
const HOME_EXAMPLES = ["Funny graphic novels", "Animal adventures", "Mysteries that aren\u2019t too scary"];
const REFINEMENTS = ["not too scary", "graphic novels", "funny", "animals"];

// Catalog vocabulary normally comes from the loaded catalog; a few known
// terms stand in for it here.
catalog.idf = new Map(["dragons", "dragon", "toys", "cooking", "story"].map((t) => [t, 1]));

test("empty input is empty, never a match", () => {
  for (const text of ["", "   "]) assert.equal(assessIntention(text).status, "empty");
});

test("supported book intentions, including topics that name other categories", () => {
  for (const text of [
    "books for Johnny, age 10, who likes funny mysteries",
    "funny mysteries",
    "books about toys",
    "a story about cooking",
    "books about cooking",
    "books about pizza",
    "dragons",
  ]) {
    const a = assessIntention(text);
    assert.equal(a.status, "supported", text);
    assert.deepEqual(a.unsupportedCategories, [], text);
  }
});

test("unsupported categories are rejected without books", () => {
  const a = assessIntention("groceries for the week");
  assert.equal(a.status, "unsupported");
  assert.ok(a.unsupportedCategories.length > 0);
  assert.equal(a.supportedText, null);
});

test("pizza shopping is unsupported rather than a book intention", () => {
  for (const text of ["pizza for Friday", "pizzas for dinner"]) {
    const assessment = assessIntention(text);
    assert.equal(assessment.status, "unsupported", text);
    assert.equal(assessment.supportedText, null);
    assert.deepEqual(assessment.unsupportedCategories.map((category) => category.key), ["grocery"]);
  }
});

test("mixed requests keep only the supported book part", () => {
  const a = assessIntention("books and toys for Johnny");
  assert.equal(a.status, "mixed");
  assert.deepEqual(a.unsupportedCategories.map((c) => c.key), ["toys"]);
  assert.equal(a.supportedText, "books for Johnny");
});

test("mixed category-plus-age requests cannot bypass the catalog-age check", () => {
  const a = assessIntention("books for toddlers and toys");
  assert.equal(a.status, "mixed");
  assert.ok(a.caveats[0]?.includes("grades 4\u20135"));
  // Home and Edit intention reassess the narrowed text before committing.
  assert.equal(assessIntention(a.supportedText!).status, "mismatch");
});

test("uninterpretable text is reported, not ranked", () => {
  assert.equal(assessIntention("asdfgh qwerty").status, "uninterpretable");
});

test("catalog mismatch for ages clearly outside grades 4\u20135", () => {
  for (const text of ["books for a 3 year old", "picture books for toddlers"]) {
    const a = assessIntention(text);
    assert.equal(a.status, "mismatch", text);
    assert.ok(a.caveats[0]?.includes("grades 4\u20135"), text);
  }
  assert.equal(assessIntention("books for a 10 year old").status, "supported");
});

test("unapplied details are disclosed as caveats, never as applied", () => {
  const a = assessIntention("funny mysteries under $10, not too long");
  assert.equal(a.status, "supported");
  const text = a.caveats.join(" ").toLowerCase();
  assert.ok(text.includes("price"), text);
  assert.ok(text.includes("length"), text);
});

test("assessment is deterministic and side-effect free", () => {
  const input = "books and toys for Johnny";
  assert.deepEqual(assessIntention(input), assessIntention(input));
});

test("Home examples are curated prompts with fixed interpretations", () => {
  for (const example of HOME_EXAMPLES) {
    assert.ok(CURATED_PROMPTS.some((p) => p.query === example), example);
    assert.equal(interpret(example).source, "curated", example);
    assert.equal(assessIntention(example).status, "supported", example);
  }
});

test("refinement suggestions map to real interpreter vocabulary", () => {
  for (const text of REFINEMENTS) {
    const i = interpret(text);
    assert.ok(i.themes.length + i.formats.length + i.reduce.length > 0, text);
    const a = assessIntention(text);
    assert.equal(a.status, "supported", text);
    assert.equal(a.actionable, true, text);
  }
});

const session: Session = {
  id: "unit-clear", modeId: "johnny", query: null, queryPromptId: null,
  querySource: null, queryInterpretation: null, pivotBookId: null,
  rankingVersion: 4, createdAt: new Date(0), updatedAt: new Date(0),
};

test("clearing negatives advances the ranking version even with unchanged inputs", () => {
  assert.equal(withNegativesCleared(session, session, true).rankingVersion, 5);
  assert.equal(withNegativesCleared(session, session, false).rankingVersion, 4);
  const changed = { ...session, rankingVersion: 5 };
  assert.equal(withNegativesCleared(changed, session, true).rankingVersion, 5);
});
