import type { IntentionAssessment } from '@workspace/api-client-react';
import { EMPTY_MESSAGE, UNINTERPRETABLE_MESSAGE, assessmentOutcome } from '@/lib/intention';
import type { AssessmentOutcome } from '@/lib/intention';

export type EntryNotice = (Extract<AssessmentOutcome, { kind: 'blocked' }> & { failure?: boolean }) | null;

export interface EntryState {
  busy: boolean;
  notice: EntryNotice;
}

interface Deps {
  assess: (text: string) => Promise<IntentionAssessment>;
  /** Commit a new working context and navigate to discovery. */
  commit: (text: string) => void;
  onChange: (state: EntryState) => void;
}

/**
 * Home's prepare-then-commit entry. One assessment at a time; any newer
 * choice (typing, Browse all books, Open Mode, another submission) retires
 * an assessment in flight so its late response can never commit.
 */
export class HomeEntry {
  private token = 0;
  private state: EntryState = { busy: false, notice: null };

  constructor(private deps: Deps) {}

  get snapshot(): EntryState { return this.state; }

  private set(patch: Partial<EntryState>) {
    this.state = { ...this.state, ...patch };
    this.deps.onChange(this.state);
  }

  /** The shopper edited the text or chose another action. */
  cancel() {
    this.token++;
    if (this.state.busy || this.state.notice) this.set({ busy: false, notice: null });
  }

  async submit(raw: string): Promise<void> {
    if (this.state.busy) return; // one submission at a time
    const value = raw.replace(/\s+/g, ' ').trim();
    if (!value) {
      this.set({ notice: { kind: 'blocked', message: EMPTY_MESSAGE, offerBrowse: true } });
      return;
    }
    const mine = ++this.token;
    this.set({ busy: true, notice: null });
    try {
      const assessment = await this.deps.assess(value);
      if (mine !== this.token) return;
      const outcome = assessmentOutcome(assessment);
      this.set({ busy: false, notice: outcome.kind === 'blocked' ? outcome : null });
      if (outcome.kind === 'proceed') this.deps.commit(value);
    } catch {
      if (mine !== this.token) return;
      this.set({ busy: false, notice: { kind: 'blocked', message: UNINTERPRETABLE_MESSAGE, retryable: true, offerBrowse: true, failure: true } });
    }
  }

  /**
   * "Continue with books" narrows a mixed request, so the remaining text is
   * assessed again (it may still mismatch the catalog). "Continue with
   * available books" is the explicit acknowledgement of a mismatch.
   */
  async continueWith(notice: NonNullable<EntryNotice>): Promise<void> {
    const text = notice.continueText;
    if (!text) return;
    if (notice.continueLabel === 'Continue with books') {
      this.cancel();
      await this.submit(text);
      return;
    }
    this.cancel();
    this.deps.commit(text);
  }
}
