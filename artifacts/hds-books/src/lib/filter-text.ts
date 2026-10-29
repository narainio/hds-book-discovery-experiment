import type { IntentionAssessment } from '@workspace/api-client-react';
import { normalizeWords } from '@/lib/filter-controller';
import { assessmentOutcome } from '@/lib/intention';
import type { AssessmentOutcome } from '@/lib/intention';

export type FilterTextResult =
  | { kind: 'empty' }
  | { kind: 'stale' }
  | { kind: 'applied'; text: string }
  | { kind: 'blocked'; outcome: Extract<AssessmentOutcome, { kind: 'blocked' }> };

/**
 * The Filter's one text string: a submission REPLACES the words (never adds).
 * The full text goes to editIntention; the book and "Fewer like this" choices
 * are kept by editIntention itself. addRefinement is never used here.
 */
export async function submitFilterText(
  raw: string,
  deps: {
    assess: (text: string) => Promise<IntentionAssessment>;
    editIntention: (text: string) => void;
    setTarget: (text: string) => void;
    isCurrent?: () => boolean;
  },
): Promise<FilterTextResult> {
  const text = normalizeWords(raw);
  if (!text) return { kind: 'empty' };
  const outcome = assessmentOutcome(await deps.assess(text));
  if (deps.isCurrent && !deps.isCurrent()) return { kind: 'stale' };
  if (outcome.kind !== 'proceed') return { kind: 'blocked', outcome };
  deps.setTarget(text);
  deps.editIntention(text);
  return { kind: 'applied', text };
}
