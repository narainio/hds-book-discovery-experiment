/**
 * Turns a natural-language direction into a structured interpretation.
 *
 * Curated prompts are hard-mapped and never touch this logic's fuzzy path, so
 * the six demo prompts behave identically every time. Free text uses a
 * deterministic keyword pass. A language model is optional and, when absent,
 * nothing here degrades.
 */
import {
  CURATED_PROMPTS,
  THEME_KEYWORDS,
  FORMAT_KEYWORDS,
  REDUCE_KEYWORDS,
  type CuratedPromptDefinition,
} from "./config";
import { tokenize, catalog } from "./catalog";

/**
 * Builds a word-boundary matcher for a keyword.
 *
 * Plain substring matching produced false positives that changed results:
 * "isn't too scary" contains "car", which pulled the Transportation theme into
 * a query about a gentle mystery. `allowPlural` is used when matching against
 * catalog prose, where "ghost" should still catch "ghosts".
 */
export function buildTermMatcher(keyword: string, allowPlural = false): RegExp {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const suffix = allowPlural ? "(?:s|es)?" : "";
  return new RegExp(`(?:^|[^a-z])${escaped}${suffix}(?:[^a-z]|$)`, "i");
}

function mentions(text: string, keyword: string): boolean {
  return buildTermMatcher(keyword).test(text);
}

const VALID_SOURCES = new Set(["curated", "lexical", "model"]);

/**
 * Validates an interpretation loaded from the session row.
 *
 * The column is jsonb, so its contents are whatever was written previously -
 * possibly by an older build with a different shape. Trusting it would let a
 * malformed row reach the ranker and throw. Anything unrecognised returns null
 * so the caller recomputes deterministically.
 */
export function coerceStoredInterpretation(
  value: unknown,
): Interpretation | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;

  const stringList = (input: unknown): string[] | null => {
    if (!Array.isArray(input)) return null;
    if (!input.every((entry) => typeof entry === "string")) return null;
    return (input as string[]).slice(0, 32);
  };

  const themes = stringList(record["themes"]);
  const formats = stringList(record["formats"]);
  const reduce = stringList(record["reduce"]);
  const terms = stringList(record["terms"]);
  if (!themes || !formats || !reduce || !terms) return null;

  const seriesHint = record["seriesHint"];
  if (seriesHint !== null && typeof seriesHint !== "string") return null;

  const source = record["source"];
  if (typeof source !== "string" || !VALID_SOURCES.has(source)) return null;

  return {
    themes,
    formats,
    reduce,
    terms,
    seriesHint: seriesHint ?? null,
    source: source as Interpretation["source"],
  };
}

export type Interpretation = {
  themes: string[];
  formats: string[];
  reduce: string[];
  terms: string[];
  seriesHint: string | null;
  source: "curated" | "lexical" | "model";
};

function fromCuratedPrompt(prompt: CuratedPromptDefinition): Interpretation {
  return {
    themes: [...prompt.themes],
    formats: [...prompt.formats],
    reduce: [...prompt.reduce],
    terms: [...prompt.terms],
    seriesHint: prompt.seriesHint,
    source: "curated",
  };
}

export function interpret(
  queryText: string,
  promptId?: string | null,
): Interpretation {
  if (promptId) {
    const prompt = CURATED_PROMPTS.find((entry) => entry.id === promptId);
    if (prompt) return fromCuratedPrompt(prompt);
  }

  const normalized = queryText.toLowerCase();

  // An exact match on curated prompt text also takes the deterministic path.
  const matchingPrompt = CURATED_PROMPTS.find(
    (prompt) => prompt.query.toLowerCase() === normalized,
  );
  if (matchingPrompt) return fromCuratedPrompt(matchingPrompt);

  const themes: string[] = [];
  for (const [theme, keywords] of Object.entries(THEME_KEYWORDS)) {
    if (keywords.some((keyword) => mentions(normalized, keyword))) {
      themes.push(theme);
    }
  }

  const formats: string[] = [];
  for (const [format, keywords] of Object.entries(FORMAT_KEYWORDS)) {
    if (keywords.some((keyword) => mentions(normalized, keyword))) {
      formats.push(format);
    }
  }

  // Negations are detected as whole phrases so that "not too scary" reduces
  // scary content rather than contributing "scary" as a positive term.
  const reduce: string[] = [];
  let positiveText = normalized;
  for (const [concept, phrases] of Object.entries(REDUCE_KEYWORDS)) {
    for (const phrase of phrases) {
      if (positiveText.includes(phrase)) {
        reduce.push(concept);
        positiveText = positiveText.replace(phrase, " ");
      }
    }
  }

  // A series the parent named explicitly, e.g. "like Geronimo Stilton".
  let seriesHint: string | null = null;
  for (const [seriesLower, entry] of catalog.seriesIndex) {
    if (seriesLower.length >= 6 && normalized.includes(seriesLower)) {
      seriesHint = entry.name;
      break;
    }
  }

  return {
    themes,
    formats,
    reduce: [...new Set(reduce)],
    terms: tokenize(positiveText),
    seriesHint,
    source: "lexical",
  };
}

/**
 * Short label used inside the "Matches ..." explanation template. Keeping it
 * short avoids a two-line reason on a narrow card.
 */
export function queryLabel(queryText: string): string {
  const trimmed = queryText.trim().replace(/^["\u201c]|["\u201d]$/g, "");
  if (trimmed.length <= 32) return trimmed.toLowerCase();
  return `${trimmed.slice(0, 29).trimEnd().toLowerCase()}\u2026`;
}
