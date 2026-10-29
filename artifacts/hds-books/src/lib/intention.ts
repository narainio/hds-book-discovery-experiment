import type { IntentionAssessment, QueryInterpretation } from '@workspace/api-client-react';
import { normalizeWords } from '@/lib/filter-controller';

/**
 * Pure helpers for the Home → Filter entry journey. The existing interpreter
 * only reads one query string, so a base intention and its additive textual
 * refinements are composed into that one effective query; nothing here ranks
 * or interprets books.
 */

/** Join base intention and refinements into one readable effective query. */
export function composeQuery(base: string | null, refinements: readonly string[]): string | null {
  const parts = [base, ...refinements]
    .map((part) => normalizeWords(part)?.replace(/[\s.,;]+$/, '') ?? null)
    .filter((part): part is string => !!part);
  return parts.length > 0 ? parts.join(', ') : null;
}

/** Example prompts on Home. Each is a curated prompt with a fixed, verified interpretation. */
export const HOME_EXAMPLES = ['Funny graphic novels', 'Animal adventures', 'Mysteries that aren’t too scary'] as const;

/**
 * Refinement suggestions. Each maps to real interpreter vocabulary (a theme,
 * a format, or a reduce concept); tests verify that against the server
 * interpreter. Suggestions already present in the effective query are hidden.
 */
export const REFINEMENT_SUGGESTIONS = [
  { id: 'not-scary', label: 'Not too scary', text: 'not too scary' },
  { id: 'graphic', label: 'Graphic novels', text: 'graphic novels' },
  { id: 'funny', label: 'Funny', text: 'funny' },
  { id: 'animals', label: 'Animals', text: 'animals' },
] as const;

export function visibleSuggestions(effective: string | null) {
  const lower = (effective ?? '').toLowerCase();
  return REFINEMENT_SUGGESTIONS.filter((s) => !lower.includes(s.text));
}

const REDUCE_LABELS: Record<string, string> = { scary: 'less scary', sad: 'less sad', romance: 'no romance' };

/**
 * Human labels for the soft ranking preferences actually used for the
 * committed results. "long" is detected but has no ranking effect, so it is
 * never shown as applied.
 */
export function preferenceLabels(interpretation: QueryInterpretation | null | undefined): string[] {
  if (!interpretation) return [];
  const labels = [
    ...interpretation.themes,
    ...interpretation.formats,
    ...(interpretation.seriesHint ? [`${interpretation.seriesHint} series`] : []),
    ...interpretation.reduce.filter((r) => r in REDUCE_LABELS).map((r) => REDUCE_LABELS[r]),
  ];
  if (labels.length === 0 && interpretation.terms.length > 0) {
    labels.push(`words: ${interpretation.terms.slice(0, 4).join(', ')}`);
  }
  return [...new Set(labels)];
}

function listJoin(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export type AssessmentOutcome =
  | { kind: 'proceed'; text: string | null }
  | { kind: 'blocked'; message: string; continueLabel?: string; continueText?: string | null; offerBrowse?: boolean; offerEdit?: boolean; retryable?: boolean };

export const EMPTY_MESSAGE = 'Describe what you’re looking for, or browse all books.';
export const UNINTERPRETABLE_MESSAGE = 'We couldn’t interpret your request. Your text is still here.';

/** Spec copy for each assessment status. Never presents unsupported input as a match. */
export function assessmentOutcome(a: IntentionAssessment): AssessmentOutcome {
  switch (a.status) {
    case 'empty':
      return { kind: 'blocked', message: EMPTY_MESSAGE, offerBrowse: true };
    case 'supported':
      return { kind: 'proceed', text: a.text };
    case 'unsupported': {
      const label = a.unsupportedCategories[0]?.label ?? 'That';
      return {
        kind: 'blocked',
        message: `${label} discovery isn’t available yet. This prototype currently supports books.`,
        offerEdit: true,
        offerBrowse: true,
      };
    }
    case 'mixed':
      return {
        kind: 'blocked',
        message: `We can explore books, but ${listJoin(a.unsupportedCategories.map((c) => c.plural))} aren’t available here yet.`,
        continueLabel: 'Continue with books',
        continueText: a.supportedText,
        offerEdit: true,
      };
    case 'mismatch':
      return {
        kind: 'blocked',
        message: a.caveats[0] ?? 'This catalog has books labeled grades 4–5 only.',
        continueLabel: 'Continue with available books',
        continueText: a.text,
        offerEdit: true,
      };
    default:
      return { kind: 'blocked', message: UNINTERPRETABLE_MESSAGE, retryable: true, offerBrowse: true };
  }
}

/**
 * A refinement must add something the engine can use. Otherwise the text is
 * kept and the shopper is told plainly that it was not applied.
 */
export function refinementOutcome(a: IntentionAssessment): { apply: true } | { apply: false; message: string } {
  const quoted = `“${a.text}”`;
  if (a.status === 'empty') return { apply: false, message: 'Type something to add to your Filter.' };
  if (a.status === 'unsupported' || a.status === 'mixed') {
    return { apply: false, message: `${capitalize(listJoin(a.unsupportedCategories.map((c) => c.plural)))} aren’t available here, so ${quoted} wasn’t applied.` };
  }
  if (a.status === 'mismatch') return { apply: false, message: `${a.caveats[0]} ${quoted} wasn’t applied.` };
  if (a.status === 'uninterpretable') {
    return { apply: false, message: `We couldn’t match ${quoted} to this catalog, so it wasn’t applied. Try different words.` };
  }
  if (!a.actionable) {
    return { apply: false, message: `${a.caveats[0] ?? 'Nothing in it can shape results.'} ${quoted} wasn’t applied.` };
  }
  return { apply: true };
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const MAX_SUGGESTED_NAME = 48;

/** Deterministic, grounded name suggestion for Save as Mode. */
export function suggestModeName(input: {
  base: string | null;
  refinements: readonly string[];
  bookTitle: string | null;
  sourceModeName: string | null;
}): string {
  const base = normalizeWords(input.base) ?? normalizeWords(input.refinements[0]);
  if (base) {
    let name = capitalize(base.replace(/[\s.,;]+$/, ''));
    if (name.length > MAX_SUGGESTED_NAME) {
      const cut = name.slice(0, MAX_SUGGESTED_NAME);
      name = (cut.lastIndexOf(' ') > 20 ? cut.slice(0, cut.lastIndexOf(' ')) : cut).replace(/[\s,;]+$/, '');
    }
    return name;
  }
  if (input.bookTitle) {
    const short = input.bookTitle.replace(/\s*\([^)]*\)\s*$/, '').trim();
    return `More like ${short}`.slice(0, MAX_SUGGESTED_NAME).trim();
  }
  if (input.sourceModeName) return input.sourceModeName;
  return 'My book discovery';
}

export const MODE_NAME_MAX = 60;

export function validateModeName(raw: string): { ok: true; name: string } | { ok: false; message: string } {
  const name = raw.replace(/\s+/g, ' ').trim();
  if (!name) return { ok: false, message: 'Enter a name for this filter.' };
  if (name.length > MODE_NAME_MAX) return { ok: false, message: `Use ${MODE_NAME_MAX} characters or fewer.` };
  return { ok: true, name };
}

/** Leading filler phrases removed (once) by shortFilterLabel. Longest first. */
export const FILLER_PHRASES = [
  'books to be', 'books that are', 'books that', 'books about', 'books for', 'books with',
  'a book about', 'a book for', 'something', 'i want', 'looking for',
] as const;

export const SHORT_LABEL_MAX = 28;

function truncateLabel(text: string): string {
  if (text.length <= SHORT_LABEL_MAX) return text;
  const cut = text.slice(0, SHORT_LABEL_MAX + 1);
  const space = cut.lastIndexOf(' ');
  const head = (space > 0 ? cut.slice(0, space) : text.slice(0, SHORT_LABEL_MAX)).replace(/[\s,;:.]+$/, '');
  return `${head}…`;
}

/** Deterministic short label for the Filter's text slot. No network calls. */
export function shortFilterLabel(text: string): string {
  const normalized = (normalizeWords(text) ?? '').replace(/[\s.,;:!?]+$/, '');
  let rest = normalized;
  for (const phrase of FILLER_PHRASES) {
    const re = new RegExp(`^${phrase.replace(/ /g, '\\s+')}(?=\\s|$)`, 'i');
    if (re.test(rest)) { rest = rest.replace(re, '').trim(); break; }
  }
  const label = rest ? capitalize(rest) : normalized;
  return truncateLabel(label);
}
