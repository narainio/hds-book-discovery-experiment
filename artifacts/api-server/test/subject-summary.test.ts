import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSubjectPayload,
  getValidSubjectSummary,
  SUBJECT_SUMMARY_PROMPT_VERSION,
  subjectSourceHash,
  validateSubjectSummary,
  type SubjectSource,
} from "../src/domain/subject-summary";

const product: SubjectSource = {
  title: "River Mystery",
  description: "Two siblings investigate why wildlife is disappearing.",
  subjects: ["Mysteries > Family mysteries", "Nature > Rivers"],
  tags: ["Mystery", "Internal Workflow"],
  formatLabel: "Paperback",
  readingLevel: "Grade 4",
  seriesName: "River Detectives",
};

test("buildSubjectPayload includes only the approved generation fields", () => {
  const payload = buildSubjectPayload(product);
  assert.deepEqual(Object.keys(payload), [
    "title",
    "description",
    "subjects",
    "displayTopics",
    "approvedTags",
    "format",
    "readingLevel",
    "series",
    "promptVersion",
  ]);
  assert.equal(payload.promptVersion, SUBJECT_SUMMARY_PROMPT_VERSION);
  assert.equal(payload.series, product.seriesName);
  assert.ok(!("price" in payload));
});

test("source hashes are stable and invalidate every approved input", () => {
  const first = subjectSourceHash(product);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, subjectSourceHash({ ...product }));
  assert.notEqual(
    first,
    subjectSourceHash({ ...product, description: `${product.description} New.` }),
  );
  assert.notEqual(
    first,
    subjectSourceHash({ ...product, subjects: [...product.subjects].reverse() }),
  );
  assert.notEqual(
    first,
    subjectSourceHash({ ...product, seriesName: null }),
  );
});

test("summary validation enforces sentence, size, and content boundaries", () => {
  assert.equal(
    validateSubjectSummary(
      "Two siblings investigate a wildlife mystery centered on a river.",
    ),
    true,
  );
  assert.equal(validateSubjectSummary("Two fragments. Another fragment."), false);
  assert.equal(validateSubjectSummary("A useful fragment without punctuation"), false);
  assert.equal(validateSubjectSummary("Perfect for curious young readers."), false);
  assert.equal(
    validateSubjectSummary(
      "This book is perfect, ideal, recommended, and safe.",
    ),
    false,
  );
  assert.equal(
    validateSubjectSummary(
      "This award winner is a promotional reader favorite.",
    ),
    false,
  );
  assert.equal(
    validateSubjectSummary(
      "Published by Acme, this book explores friendship.",
    ),
    false,
  );
  assert.equal(
    validateSubjectSummary(
      "Two siblings solve the mystery before safely returning home.",
    ),
    true,
  );
  assert.equal(validateSubjectSummary("<b>A family mystery.</b>"), false);
  assert.equal(validateSubjectSummary("Subjects: family and rivers."), false);
  assert.equal(validateSubjectSummary("- A family mystery."), false);
  assert.equal(
    validateSubjectSummary(`${"word ".repeat(28)}word.`),
    false,
  );
});

test("cached summary is returned only while ready, current, and valid", () => {
  const summary =
    "Two siblings investigate a wildlife mystery centered on a river.";
  const validCache = {
    subjectSummary: summary,
    subjectSummaryStatus: "ready",
    subjectSummaryPromptVersion: SUBJECT_SUMMARY_PROMPT_VERSION,
    subjectSummarySourceHash: subjectSourceHash(product),
  };
  assert.equal(getValidSubjectSummary(product, validCache), summary);
  assert.equal(
    getValidSubjectSummary(product, {
      ...validCache,
      subjectSummaryStatus: "failed",
    }),
    null,
  );
  assert.equal(
    getValidSubjectSummary(product, {
      ...validCache,
      subjectSummaryPromptVersion: "old",
    }),
    null,
  );
  assert.equal(
    getValidSubjectSummary(
      { ...product, title: "Changed" },
      validCache,
    ),
    null,
  );
  assert.equal(
    getValidSubjectSummary(product, {
      ...validCache,
      subjectSummary: "Perfect for every reader.",
    }),
    null,
  );
});