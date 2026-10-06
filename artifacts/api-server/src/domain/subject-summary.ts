import { createHash } from "node:crypto";

import {
  buildDisplayTopics,
  getApprovedSubjectTags,
} from "./subject-normalizer";

export const SUBJECT_SUMMARY_MODEL = "google/gemini-3.6-flash";
export const SUBJECT_SUMMARY_PROMPT_VERSION = "1";
export const SUBJECT_SUMMARY_TIMEOUT_MS = 10_000;

/**
 * The deliberately small product boundary available to subject enrichment.
 * Commerce, ranking, customer, and raw supplier fields cannot enter the prompt.
 */
export interface SubjectSource {
  title: string;
  description: string;
  subjects: string[];
  tags: string[];
  formatLabel: string;
  readingLevel: string;
  seriesName: string | null;
}

export interface SubjectPayload {
  title: string;
  description: string;
  subjects: string[];
  displayTopics: string[];
  approvedTags: string[];
  format: string;
  readingLevel: string;
  series: string | null;
  promptVersion: string;
}

export interface SubjectSummaryCache {
  subjectSummary: string | null;
  subjectSummaryStatus: string | null;
  subjectSummaryPromptVersion: string | null;
  subjectSummarySourceHash: string | null;
}

/**
 * No truncation is performed: generation and hashing use these exact values.
 * Array order is significant and object key order is fixed by this constructor.
 */
export function buildSubjectPayload(product: SubjectSource): SubjectPayload {
  return {
    title: product.title,
    description: product.description,
    subjects: [...product.subjects],
    displayTopics: buildDisplayTopics({
      subjects: product.subjects,
      tags: product.tags,
    }),
    approvedTags: getApprovedSubjectTags(product.tags),
    format: product.formatLabel,
    readingLevel: product.readingLevel,
    series: product.seriesName,
    promptVersion: SUBJECT_SUMMARY_PROMPT_VERSION,
  };
}

/**
 * SHA-256 of the JSON serialization of the exact prompt payload. Arrays retain
 * source/normalizer order; keys have the fixed order in buildSubjectPayload.
 */
export function subjectSourceHash(product: SubjectSource): string {
  return createHash("sha256")
    .update(JSON.stringify(buildSubjectPayload(product)), "utf8")
    .digest("hex");
}

const PROHIBITED_PHRASES = [
  "perfect for",
  "ideal for",
  "johnny will",
  "your child will",
  "guaranteed",
  "age-appropriate",
  "age appropriate",
  "highly recommended",
  "bestseller",
  "best-selling",
  "award-winning",
  "award winning",
  "safe for",
  "educational",
  "teaches children",
  "hds",
] as const;

/**
 * Standalone promotional/suitability words are rejected even when a model
 * avoids the better-known phrases above. Word boundaries intentionally reject
 * "safe" but not grounded plot wording such as "safely returns home".
 */
const PROHIBITED_OUTPUT_PATTERNS = [
  /\b(?:perfect|ideal|recommend(?:ed|ation)?|safe|suitable|suitability)\b/iu,
  /\b(?:promotional|reader(?:'s|s')?\s+favorite|fan\s+favorite|must-read)\b/iu,
  /\b(?:award(?:[-\s]?winning)?|award\s+winner|winner\s+of\s+(?:an?\s+|the\s+)?[^.!?]{0,40}\baward)\b/iu,
  /\b(?:published\s+by|publisher|catalog(?:ue)?|metadata|artificial\s+intelligence|AI)\b/iu,
] as const;

/**
 * Validates customer-facing copy, not a model envelope. An empty summary is a
 * valid model abstention at the parsing layer, but is never itself a summary.
 */
export function validateSubjectSummary(summary: string): boolean {
  if (summary.length === 0 || summary !== summary.trim()) return false;
  if (summary.length > 240 || /[\r\n]/.test(summary)) return false;
  if (/[\u0000-\u001f\u007f-\u009f]/.test(summary)) return false;

  const words = summary.split(/\s+/u);
  if (words.length > 28 || words.some((word) => word.length === 0)) return false;

  // Segmenting avoids miscounting grounded abbreviations such as "U.S.".
  if (!/[.!?]$/.test(summary)) return false;
  const sentences = [
    ...new Intl.Segmenter("en", { granularity: "sentence" }).segment(summary),
  ].filter((part) => part.segment.trim().length > 0);
  if (sentences.length !== 1) return false;

  const lower = summary.toLocaleLowerCase("en-US");
  if (PROHIBITED_PHRASES.some((phrase) => lower.includes(phrase))) return false;
  if (PROHIBITED_OUTPUT_PATTERNS.some((pattern) => pattern.test(summary))) {
    return false;
  }
  if (/(?:^|\s)(?:subjects?|description|tags?|format|reading level)\s*:/iu.test(summary)) {
    return false;
  }

  // Reject HTML and common Markdown constructs/bullets rather than sanitizing.
  if (/<\/?[a-z][^>]*>/iu.test(summary)) return false;
  if (/^\s*(?:[-+*>]|\d+[.)])\s/u.test(summary)) return false;
  if (/[*_`#]|\[[^\]]*\]\([^)]*\)/u.test(summary)) return false;

  // Disallow first-person institutional claims and overt recommendations.
  if (/\b(?:we|our|i)\s+(?:believe|think|recommend|guarantee)\b/iu.test(summary)) {
    return false;
  }
  if (
    /\b(?:(?:readers?|children|kids?|your child)\s+(?:will\s+)?(?:enjoy|love|benefit)|suited to|recommended for|must-read)\b/iu.test(
      summary,
    )
  ) {
    return false;
  }

  return true;
}

export function getValidSubjectSummary(
  product: SubjectSource,
  cache: SubjectSummaryCache,
): string | null {
  if (cache.subjectSummaryStatus !== "ready") return null;
  if (cache.subjectSummaryPromptVersion !== SUBJECT_SUMMARY_PROMPT_VERSION) {
    return null;
  }
  if (cache.subjectSummarySourceHash !== subjectSourceHash(product)) return null;
  if (
    typeof cache.subjectSummary !== "string" ||
    !validateSubjectSummary(cache.subjectSummary)
  ) {
    return null;
  }
  return cache.subjectSummary;
}