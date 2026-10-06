import assert from "node:assert/strict";
import test from "node:test";
import type { Product } from "@workspace/db";
import { GetBookResponse } from "@workspace/api-zod";
import { toBookDetail } from "../src/domain/serializers";
import { getValidSubjectSummary, subjectSourceHash, SUBJECT_SUMMARY_PROMPT_VERSION } from "../src/domain/subject-summary";

const product: Product = {
  id: "subject-fixture", title: "A Coding Story", author: "An Author",
  illustrator: null, seriesName: null, description: "A memoir about coding.",
  coverImageUrl: null, readingLevel: "4th − 5th Grade", publisher: null,
  publicationDate: null, sourceUrl: "", price: 10, currency: "USD",
  formatLabel: "Paperback", availabilityLabel: null, editions: [],
  subjects: ["STEM > Computers & Digital Media > Coding & Programming"],
  topSubjects: ["STEM"], tags: [], bookScore: null, awardCount: 0,
  publicationYear: null, searchText: "a coding story", rawSource: null,
  subjectSummary: null, subjectSummaryStatus: null, subjectSummaryModel: null,
  subjectSummaryPromptVersion: null, subjectSummarySourceHash: null,
  subjectSummaryGeneratedAt: null, subjectSummaryError: null,
  subjectSummaryAttemptId: null, subjectSummaryAttemptedAt: null,
};

test("detail contract preserves source subjects and hides all private fields", () => {
  const ready = {
    ...product,
    subjectSummary: "A memoir about coding.",
    subjectSummaryStatus: "ready" as const,
    subjectSummaryPromptVersion: SUBJECT_SUMMARY_PROMPT_VERSION,
    subjectSummarySourceHash: subjectSourceHash(product),
    subjectSummaryError: "private-error",
    subjectSummaryModel: "private-model",
  };
  const dto = toBookDetail(product, getValidSubjectSummary(product, ready));
  assert.deepEqual(GetBookResponse.parse(dto), dto);
  assert.deepEqual(dto.subjects, product.subjects);
  assert.deepEqual(dto.displayTopics, ["Coding and technology"]);
  assert.equal(dto.subjectSummary, "A memoir about coding.");
  for (const key of Object.keys(ready).filter(k => k.startsWith("subjectSummary") && k !== "subjectSummary")) {
    assert.equal(key in dto, false, key);
  }
  assert.doesNotMatch(JSON.stringify(dto), /private-error|private-model/);
});

test("absent and stale cache produce null without modifying source/ranking fields", () => {
  const original = structuredClone(product);
  assert.equal(toBookDetail(product).subjectSummary, null);
  const stale = { ...product, subjectSummary: "A memoir about coding.", subjectSummaryStatus: "ready" as const,
    subjectSummarySourceHash: "old", subjectSummaryPromptVersion: SUBJECT_SUMMARY_PROMPT_VERSION };
  assert.equal(toBookDetail(product, getValidSubjectSummary(product, stale)).subjectSummary, null);
  assert.deepEqual(product, original);
});