/**
 * Bounded, deterministic scope assessment for a shopper's written intention.
 *
 * This is not a universal intent classifier. It answers a narrow question
 * before discovery commits anything: can this books-only prototype honestly
 * act on the text, and which parts of it will NOT be applied? It never calls
 * a model, never writes, and reuses the deterministic interpreter and catalog
 * vocabulary, so it is safe to call on every submission.
 *
 * Important: a shopping category named as a book TOPIC ("books about
 * cooking", "a story about toys") is a supported book request, not an
 * unsupported category.
 */
import { interpret, buildTermMatcher } from "./interpreter";
import { catalog, tokenize } from "./catalog";
import { MODE } from "./config";

export type AssessmentStatus =
  | "empty"
  | "supported"
  | "unsupported"
  | "mixed"
  | "uninterpretable"
  | "mismatch";

/** label: sentence-case singular for "X discovery"; plural: for "X aren’t available". */
export type UnsupportedCategory = { key: string; label: string; plural: string };

export type IntentionAssessment = {
  text: string;
  status: AssessmentStatus;
  /** Shopping categories requested as products (never book topics). */
  unsupportedCategories: UnsupportedCategory[];
  /** The text with unsupported category requests removed; null when nothing remains. */
  supportedText: string | null;
  /** Age or reading-level phrase outside the catalog's grades 4–5 range. */
  mismatch: string | null;
  /** Concise grounded caveats for details that will not be enforced. */
  caveats: string[];
  /** True when something in the text can shape ranking (themes, formats, reduce, series, catalog words). */
  actionable: boolean;
};

/** Categories this prototype does not stock. Label is sentence-case for copy. */
const CATEGORIES: Array<{ key: string; label: string; plural: string; words: string[] }> = [
  { key: "grocery", label: "Grocery", plural: "groceries", words: ["groceries", "grocery", "food shopping", "milk", "snacks", "cereal", "pizza", "pizzas"] },
  { key: "toys", label: "Toy", plural: "toys", words: ["toys", "toy", "lego", "legos", "action figures", "dolls", "board games", "stuffed animals", "plushies"] },
  { key: "clothing", label: "Clothing", plural: "clothes", words: ["clothes", "clothing", "shoes", "sneakers", "shirts", "t-shirts", "jackets", "dresses", "outfits"] },
  { key: "electronics", label: "Electronics", plural: "electronics", words: ["electronics", "laptop", "laptops", "tablet", "tablets", "headphones", "phone", "phones", "video games", "game console"] },
  { key: "furniture", label: "Furniture", plural: "furniture items", words: ["furniture", "bookshelf", "bookcase"] },
  { key: "pet-supplies", label: "Pet supply", plural: "pet supplies", words: ["pet food", "dog food", "cat food", "pet supplies", "dog toys", "cat litter"] },
  { key: "beauty", label: "Beauty", plural: "beauty products", words: ["makeup", "cosmetics", "shampoo", "skincare"] },
];

/** Words that make a request about books. */
const BOOK_INTENT = /\b(books?|novels?|graphic novels?|comics?|manga|read|reads|reading|stor(y|ies)|series|chapter books?|picture books?|biograph(y|ies)|poems?|poetry|audiobooks?|titles?|authors?)\b/i;

/** A category word introduced as a topic: "about X", "on X", "X-themed", "featuring X". */
function isTopicMention(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 40), index).toLowerCase();
  return /\b(about|on|featuring|involving|starring)\s+(?:[a-z'-]+\s+){0,3}$/.test(before)
    || /\b(books?|stor(?:y|ies)|novels?|comics?|graphic novels?|series)\s+(?:about|on|featuring|involving|with|where|of)\s+(?:[a-z'-]+\s+){0,3}$/.test(before);
}

function findMentions(text: string, words: string[]): Array<{ index: number; length: number }> {
  const hits: Array<{ index: number; length: number }> = [];
  for (const word of words) {
    const matcher = new RegExp(buildTermMatcher(word).source, "gi");
    for (const match of text.matchAll(matcher)) {
      const offset = match[0].toLowerCase().indexOf(word);
      hits.push({ index: (match.index ?? 0) + Math.max(0, offset), length: word.length });
    }
  }
  return hits;
}

const AGE_WORDS: Record<string, string> = {
  baby: "babies", babies: "babies", toddler: "toddlers", toddlers: "toddlers",
  preschool: "preschoolers", preschooler: "preschoolers", preschoolers: "preschoolers",
  kindergarten: "kindergarten", kindergartner: "kindergarten",
  teen: "teens", teens: "teens", teenager: "teenagers", teenagers: "teenagers",
  "young adult": "young adults", adult: "adults", adults: "adults", grownups: "adults",
};

/** Ages about 8–12 are near the catalog's grades 4–5 labeling. */
const AGE_MIN = 8;
const AGE_MAX = 12;
const GRADE_MIN = 3;
const GRADE_MAX = 6;

const AGE_PATTERNS: RegExp[] = [
  /\bages?\s+(\d{1,2})(?:\s*(?:-|to|–|−)\s*(\d{1,2}))?\b/gi,
  /\b(\d{1,2})(?:\s*(?:-|to|–|−)\s*(\d{1,2}))?[\s-]*(?:years?|yrs?)[\s-]*old\b/gi,
  /\b(\d{1,2})\s*yo\b/gi,
  /\b(\d{1,2})(?:\s*(?:-|to|–|−)\s*(\d{1,2}))?[\s-]*(?:year|yr)[\s-]*olds?\b/gi,
];
const GRADE_PATTERNS: RegExp[] = [
  /\bgrades?\s+(\d{1,2})(?:\s*(?:-|to|–|−)\s*(\d{1,2}))?\b/gi,
  /\b(\d{1,2})(?:st|nd|rd|th)(?:\s*(?:-|to|–|−)\s*(\d{1,2})(?:st|nd|rd|th))?\s+grade(?:rs?)?\b/gi,
];

type Span = { index: number; length: number };

function collectAges(text: string, spans: Span[]): { mismatch: string | null; mentioned: boolean } {
  let mismatch: string | null = null;
  let mentioned = false;
  const consider = (patterns: RegExp[], min: number, max: number, kind: "age" | "grade") => {
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        mentioned = true;
        spans.push({ index: match.index ?? 0, length: match[0].length });
        const low = Number(match[1]);
        const high = match[2] ? Number(match[2]) : low;
        if (!mismatch && (high < min || low > max)) {
          mismatch = kind === "age"
            ? `age ${low === high ? low : `${low}–${high}`}`
            : `grade ${low === high ? low : `${low}–${high}`}`;
        }
      }
    }
  };
  consider(AGE_PATTERNS, AGE_MIN, AGE_MAX, "age");
  consider(GRADE_PATTERNS, GRADE_MIN, GRADE_MAX, "grade");
  for (const [word, label] of Object.entries(AGE_WORDS)) {
    for (const hit of findMentions(text, [word])) {
      // "a story about a baby dragon" names a topic, not a reader.
      if (isTopicMention(text, hit.index)) continue;
      mentioned = true;
      spans.push(hit);
      mismatch ??= label;
    }
  }
  return { mismatch, mentioned };
}

const PRICE = /(?:\b(?:under|below|less than|cheaper than|max(?:imum)?|up to|no more than)\s*)?\$\s?\d+(?:\.\d{2})?|\b(?:under|below|less than)\s+\d+\s*(?:dollars|bucks)\b|\b\d+\s*(?:dollars|bucks)\b|\b(?:cheap|inexpensive|affordable|budget|on sale|discounted|bargain)\b/gi;
const LENGTH = /\b(?:not too long|not long|short|shorter|quick reads?|fast reads?|under \d+ pages|\d+ pages)\b/gi;
const SAFETY = /\b(?:safe|age[- ]appropriate|appropriate|no violence|non[- ]violent|clean|wholesome)\b/gi;
/** "for Johnny", "my son Leo": a capitalized name after a recipient cue. */
const NAME = /\b(?:for|to|my (?:son|daughter|kid|child|nephew|niece|grandson|granddaughter|student))\s+([A-Z][a-z]{1,20})\b/g;

const NAME_EXCLUDE = new Set([
  "Christmas", "Halloween", "Easter", "Hanukkah", "Thanksgiving", "Spanish", "English", "Geronimo", "Harry", "Dog", "Man",
]);

function stripSpans(text: string, spans: Span[]): string {
  const sorted = [...spans].sort((a, b) => b.index - a.index);
  let out = text;
  for (const span of sorted) out = `${out.slice(0, span.index)} ${out.slice(span.index + span.length)}`;
  return out;
}

/** Remove category mentions and the connectors that joined them. */
function supportedPortion(text: string, spans: Span[]): string | null {
  // Widen each span over the connector that joined it ("books and toys").
  const widened = spans.map((span) => {
    const before = text.slice(0, span.index);
    const connector = before.match(/(?:\s*(?:,|\band\b|\bor\b|\bplus\b|&|\bsome\b|\bsome\s+)\s*)+$/i);
    const start = connector ? span.index - connector[0].length : span.index;
    return { index: start, length: span.index + span.length - start };
  });
  let out = stripSpans(text, widened);
  out = out
    .replace(/^\s*(?:and|or|plus|&)\b/i, "")
    .replace(/\s+([,.])/g, "$1")
    .replace(/,\s*,/g, ",")
    .replace(/\s+/g, " ")
    .replace(/^[\s,.;]+|[\s,;]+$/g, "")
    .trim();
  return /[a-z]/i.test(out) ? out : null;
}

const REDUCE_CAVEAT: Record<string, string> = {
  scary: "“Less scary” lowers matching books in the ranking; it is not a content guarantee.",
  sad: "“Less sad” lowers matching books in the ranking; it is not a content guarantee.",
  romance: "“No romance” lowers matching books in the ranking; it is not a content guarantee.",
};

export function assessIntention(raw: string): IntentionAssessment {
  const text = raw.replace(/\s+/g, " ").trim();
  const base: IntentionAssessment = {
    text,
    status: "empty",
    unsupportedCategories: [],
    supportedText: null,
    mismatch: null,
    caveats: [],
    actionable: false,
  };
  if (!text) return base;

  // 1. Shopping categories requested as products.
  const categorySpans: Span[] = [];
  const categories: UnsupportedCategory[] = [];
  for (const category of CATEGORIES) {
    const product = findMentions(text, category.words).filter((hit) => !isTopicMention(text, hit.index));
    if (product.length === 0) continue;
    categories.push({ key: category.key, label: category.label, plural: category.plural });
    categorySpans.push(...product);
  }
  const withoutCategories = stripSpans(text, categorySpans);
  const bookIntent = BOOK_INTENT.test(withoutCategories);

  // 2. Details that will not be enforced.
  const caveats: string[] = [];
  const unappliedSpans: Span[] = [];
  const pushMatches = (pattern: RegExp) => {
    let found = false;
    for (const match of text.matchAll(pattern)) {
      found = true;
      unappliedSpans.push({ index: match.index ?? 0, length: match[0].length });
    }
    return found;
  };
  const ages = collectAges(text, unappliedSpans);
  if (pushMatches(PRICE)) caveats.push("Price limits aren’t applied; results are not filtered by price.");
  if (pushMatches(LENGTH)) caveats.push("Book length isn’t applied; the catalog has no page counts.");
  if (pushMatches(SAFETY)) caveats.push("Content suitability isn’t checked beyond the catalog’s grades 4–5 labeling.");
  const names = [...text.matchAll(NAME)]
    .map((m) => m[1])
    .filter((name) => !NAME_EXCLUDE.has(name));
  for (const match of text.matchAll(NAME)) {
    if (!NAME_EXCLUDE.has(match[1])) unappliedSpans.push({ index: (match.index ?? 0) + match[0].lastIndexOf(match[1]), length: match[1].length });
  }
  if (names.length > 0) {
    caveats.push(`${names[0]} is kept as context; HDS knows only what you wrote.`);
  }
  if (ages.mentioned && !ages.mismatch) {
    caveats.push(`Age is context only; every book here is labeled ${MODE.gradeLabel.split(" \u00b7 ")[1]}.`);
  }

  // 3. What can actually shape ranking, after removing unapplied details.
  const interpretable = stripSpans(withoutCategories, unappliedSpans);
  const interpretation = interpret(interpretable);
  const appliedReduce = interpretation.reduce.filter((concept) => concept in REDUCE_CAVEAT);
  for (const concept of appliedReduce) caveats.push(REDUCE_CAVEAT[concept]);
  const catalogTerms = tokenize(interpretable).filter((term) => catalog.idf.has(term));
  const actionable =
    interpretation.themes.length > 0 ||
    interpretation.formats.length > 0 ||
    appliedReduce.length > 0 ||
    interpretation.seriesHint !== null ||
    catalogTerms.length > 0;

  const result: IntentionAssessment = {
    ...base,
    unsupportedCategories: categories,
    supportedText: categories.length > 0 ? supportedPortion(text, categorySpans) : text,
    mismatch: ages.mismatch,
    caveats,
    actionable,
  };

  if (categories.length > 0) {
    return bookIntent
      ? {
          ...result,
          status: "mixed",
          // The book part may still fall outside the catalog; clients reassess
          // supportedText before continuing, and the caveat says why.
          caveats: ages.mismatch
            ? [`Books here are labeled ${MODE.gradeLabel.split(" \u00b7 ")[1]} (about age 10), not chosen for ${ages.mismatch}.`, ...caveats]
            : caveats,
        }
      : { ...result, status: "unsupported", supportedText: null };
  }
  if (ages.mismatch) {
    return {
      ...result,
      status: "mismatch",
      caveats: [
        `Books here are labeled ${MODE.gradeLabel.split(" \u00b7 ")[1]} (about age 10), not chosen for ${ages.mismatch}.`,
        ...caveats,
      ],
    };
  }
  if (!actionable && !bookIntent) return { ...result, status: "uninterpretable" };
  if (!actionable) {
    caveats.push("No specific preferences were recognized, so books are not narrowed.");
  }
  return { ...result, status: "supported", caveats };
}
