/**
 * Optional language-model reading of a free-text query.
 *
 * Three rules govern this module:
 *
 * 1. It is never required. No key, a timeout, a malformed reply or an unknown
 *    label all resolve to null, and the caller keeps the deterministic result.
 * 2. It is never in the ranking path. The caller invokes it once, when a query
 *    is set, and caches the outcome on the session.
 * 3. Its output never becomes customer-facing text. It may only choose from a
 *    fixed vocabulary drawn from real catalog fields; explanations are still
 *    built from reason codes and the parent's own words.
 */
import {
  THEME_KEYWORDS,
  FORMAT_KEYWORDS,
  REDUCE_CONCEPT_TERMS,
} from "./config";
import { catalog } from "./catalog";
import type { Interpretation } from "./interpreter";
import { logger } from "../lib/logger";

const MODEL = "google/gemini-3.6-flash";
const BASE_URL = "https://openrouter.ai/api/v1";

/**
 * The demo must never stall on a network call. Past this budget we abandon the
 * model and use the deterministic reading, which is already computed.
 * Typical observed latency with reasoning suppressed is ~1.0-1.4s.
 */
const TIMEOUT_MS = 5000;

const THEMES = Object.keys(THEME_KEYWORDS);
const FORMATS = Object.keys(FORMAT_KEYWORDS);
const REDUCE = Object.keys(REDUCE_CONCEPT_TERMS);

type ModelReply = {
  themes: string[];
  formats: string[];
  reduce: string[];
  keywords: string[];
  series: string | null;
};

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

/** Accepts a partial or sloppy reply; missing fields simply become empty. */
function coerceReply(value: unknown): ModelReply | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;

  return {
    themes: stringArray(record["themes"]),
    formats: stringArray(record["formats"]),
    reduce: stringArray(record["reduce"]),
    keywords: stringArray(record["keywords"]),
    series: typeof record["series"] === "string" ? record["series"] : null,
  };
}

export function isLlmConfigured(): boolean {
  return Boolean(process.env["OPENROUTER_API_KEY"]);
}

function buildSystemPrompt(): string {
  return [
    "You interpret a parent's request for a children's book into structured labels.",
    "The reader is a 10-year-old at a 4th-5th grade reading level.",
    "",
    "Reply with JSON only, matching this shape:",
    '{"themes":[],"formats":[],"reduce":[],"keywords":[],"series":null}',
    "",
    `themes: zero or more, ONLY from this list: ${JSON.stringify(THEMES)}`,
    `formats: zero or more, ONLY from this list: ${JSON.stringify(FORMATS)}`,
    `reduce: content the parent wants LESS of, ONLY from this list: ${JSON.stringify(REDUCE)}`,
    "keywords: up to 8 lowercase subject words from the request itself.",
    "series: a book series named in the request, else null.",
    "",
    "Use exact strings from the lists. Invent nothing. If the request is vague, return empty arrays.",
  ].join("\n");
}

/** Drops anything outside the allowed vocabulary, case-insensitively. */
function keepKnown(values: string[], allowed: string[]): string[] {
  const byLower = new Map(allowed.map((value) => [value.toLowerCase(), value]));
  const kept = values
    .map((value) => byLower.get(String(value).toLowerCase()))
    .filter((value): value is string => Boolean(value));
  return [...new Set(kept)];
}

function parseJson(content: string): unknown {
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return JSON.parse(cleaned);
}

/**
 * Returns an interpretation refined by the model, or null to keep `fallback`.
 * Never throws.
 */
export async function interpretWithLlm(
  queryText: string,
  fallback: Interpretation,
): Promise<Interpretation | null> {
  const apiKey = process.env["OPENROUTER_API_KEY"];
  if (!apiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Title": "HDS Kids Books Discovery",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2048,
        temperature: 0,
        response_format: { type: "json_object" },
        /**
         * Gemini 3.x flash thinks by default and spent ~540 reasoning tokens
         * (~4.8s) on this trivial classification. Suppressing it drops the
         * call to ~1.2s with no loss of accuracy on this task.
         * Note: `{ enabled: false }` is rejected with a 400 by this model.
         */
        reasoning: { effort: "minimal" },
        messages: [
          { role: "system", content: buildSystemPrompt() },
          { role: "user", content: queryText },
        ],
      }),
    });

    if (!response.ok) {
      logger.warn(
        { status: response.status },
        "Query interpretation model returned an error; using deterministic reading",
      );
      return null;
    }

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return null;

    const parsed = coerceReply(parseJson(content));
    if (!parsed) {
      logger.warn("Query interpretation model returned an unexpected shape");
      return null;
    }

    const themes = keepKnown(parsed.themes, THEMES);
    const formats = keepKnown(parsed.formats, FORMATS);
    const reduce = keepKnown(parsed.reduce, REDUCE);

    // A named series only counts if the catalog actually has it.
    let seriesHint: string | null = null;
    if (parsed.series) {
      const needle = parsed.series.toLowerCase();
      for (const [seriesLower, entry] of catalog.seriesIndex) {
        if (seriesLower.includes(needle) || needle.includes(seriesLower)) {
          seriesHint = entry.name;
          break;
        }
      }
    }

    const keywords = parsed.keywords
      .map((word) => word.toLowerCase())
      .filter((word) => /^[a-z][a-z-]{1,}$/.test(word));

    // The deterministic terms stay in play; the model only widens them.
    const terms = [...new Set([...fallback.terms, ...keywords])].slice(0, 16);

    return {
      themes,
      formats,
      reduce,
      terms,
      seriesHint: seriesHint ?? fallback.seriesHint,
      source: "model",
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    logger.warn(
      { aborted },
      "Query interpretation model unavailable; using deterministic reading",
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}
