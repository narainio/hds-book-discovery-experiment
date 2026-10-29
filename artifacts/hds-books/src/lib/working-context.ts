import { normalizeWords } from '@/lib/filter-controller';
import type { FilterInput } from '@/lib/filter-controller';
import { composeQuery } from '@/lib/intention';

/**
 * The working context records what the server cannot: how the committed
 * query was built (base intention + additive refinements), which saved Mode
 * it came from, and where the shopper was in the results. The server's
 * committed Filter stays authoritative; this record is only adopted when it
 * composes to exactly the committed words, otherwise it is rebuilt from them.
 */

export const WORKING_CONTEXT_KEY = 'hds_pf_working_context';

export type ContextOrigin = 'intention' | 'browse' | 'mode' | 'restored';

export interface WorkingContext {
  version: 1;
  sessionId: string;
  base: string | null;
  refinements: string[];
  sourceModeId: string | null;
  sourceModeName: string | null;
  /** The source Mode's context definition, kept for provenance and Save as new Mode. */
  sourceModeContext: { modeId: string; label: string } | null;
  origin: ContextOrigin;
  /** A working discovery exists and can be continued from Home. */
  started: boolean;
  scrollY: number;
}

export interface ContextProposal {
  base: string | null;
  refinements: string[];
  sourceModeId: string | null;
  sourceModeName: string | null;
  sourceModeContext: { modeId: string; label: string } | null;
  origin: ContextOrigin;
  /** Book id the committed Filter must carry; undefined means "any" (kept by the controller). */
  bookId?: string | null;
  /** True for context replacement (new intention, Browse all, Open Mode, Start over). */
  replace: boolean;
}

export interface WorkingContextState {
  committed: WorkingContext | null;
  /** Requested but not yet matched by committed results. */
  proposal: ContextProposal | null;
  /** One-off notice for the shopper (e.g. a Mode's example book is unavailable). */
  notice: string | null;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function effectiveWords(ctx: Pick<WorkingContext, 'base' | 'refinements'> | null): string | null {
  return ctx ? composeQuery(ctx.base, ctx.refinements) : null;
}

export function parseWorkingContext(raw: string | null, sessionId: string): WorkingContext | null {
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as Record<string, unknown>;
    if (!r || r.version !== 1 || r.sessionId !== sessionId) return null;
    const str = (v: unknown) => (v === null || typeof v === 'string');
    if (!str(r.base) || !str(r.sourceModeId) || !str(r.sourceModeName)) return null;
    if (!Array.isArray(r.refinements) || !r.refinements.every((x) => typeof x === 'string')) return null;
    if (!['intention', 'browse', 'mode', 'restored'].includes(r.origin as string)) return null;
    const c = r.sourceModeContext as Record<string, unknown> | null | undefined;
    const context = c && typeof c.modeId === 'string' && typeof c.label === 'string' ? { modeId: c.modeId, label: c.label } : null;
    return {
      version: 1,
      sessionId,
      base: r.base as string | null,
      refinements: [...(r.refinements as string[])],
      sourceModeId: r.sourceModeId as string | null,
      sourceModeName: r.sourceModeName as string | null,
      sourceModeContext: context,
      origin: r.origin as ContextOrigin,
      started: r.started === true,
      scrollY: typeof r.scrollY === 'number' && r.scrollY >= 0 ? r.scrollY : 0,
    };
  } catch {
    return null;
  }
}

export class WorkingContextStore {
  private state: WorkingContextState = { committed: null, proposal: null, notice: null };
  private listeners = new Set<() => void>();
  private lastSeen: FilterInput | null = null;

  constructor(private storage: StorageLike | null, private sessionId: string) {
    try {
      this.state = { ...this.state, committed: parseWorkingContext(storage?.getItem(WORKING_CONTEXT_KEY) ?? null, sessionId) };
    } catch {
      // Unreadable storage: start without a record; the server state still applies.
    }
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = () => this.state;

  private set(patch: Partial<WorkingContextState>, persist = false) {
    this.state = { ...this.state, ...patch };
    if (persist) this.persist();
    this.listeners.forEach((l) => l());
  }

  persist() {
    const committed = this.state.committed;
    if (!committed || !this.storage) return;
    try {
      this.storage.setItem(WORKING_CONTEXT_KEY, JSON.stringify(committed));
    } catch {
      // Losing provenance/scroll is tolerable; working Filter lives server-side.
    }
  }

  private matches(proposal: ContextProposal, filter: FilterInput): boolean {
    if (normalizeWords(effectiveWords(proposal)) !== normalizeWords(filter.words)) return false;
    return proposal.bookId === undefined || proposal.bookId === (filter.book?.id ?? null);
  }

  /** Request a new or edited context; adopted when matching results commit. */
  propose(proposal: ContextProposal, notice: string | null = null) {
    const copy = { ...proposal, refinements: [...proposal.refinements], sourceModeContext: proposal.sourceModeContext ? { ...proposal.sourceModeContext } : null };
    this.set({ proposal: copy, notice });
    // An edit that resolves to the already-committed words never produces a
    // new result, so adopt it immediately.
    if (this.lastSeen && !proposal.replace) this.observe(this.lastSeen);
  }

  /** Called with every committed view the Filter controller shows. */
  observe(filter: FilterInput) {
    this.lastSeen = filter;
    const { proposal, committed } = this.state;
    if (proposal && this.matches(proposal, filter)) {
      const fresh = proposal.replace;
      this.set({
        proposal: null,
        committed: {
          version: 1,
          sessionId: this.sessionId,
          base: normalizeWords(proposal.base),
          refinements: proposal.refinements.map((r) => normalizeWords(r)!).filter(Boolean),
          sourceModeId: proposal.sourceModeId,
          sourceModeName: proposal.sourceModeName,
          sourceModeContext: proposal.sourceModeContext,
          origin: proposal.origin,
          started: true,
          scrollY: fresh ? 0 : committed?.scrollY ?? 0,
        },
      }, true);
      return;
    }
    if (committed && normalizeWords(effectiveWords(committed)) === normalizeWords(filter.words)) return;
    // The server changed by another route (older build, another tab): its
    // committed words become the base intention, with no Mode provenance.
    this.set({
      committed: {
        version: 1,
        sessionId: this.sessionId,
        base: normalizeWords(filter.words),
        refinements: [],
        sourceModeId: null,
        sourceModeName: null,
        sourceModeContext: null,
        origin: 'restored',
        started: (committed?.started ?? false) || !!normalizeWords(filter.words) || !!filter.book,
        scrollY: committed?.scrollY ?? 0,
      },
    }, true);
  }

  markStarted() {
    const committed = this.state.committed;
    if (!committed || committed.started) return;
    this.set({ committed: { ...committed, started: true } }, true);
  }

  /** In-memory only; call persist() when leaving the page. */
  rememberScroll(scrollY: number) {
    const committed = this.state.committed;
    if (!committed) return;
    // Not rendered, so no listener notification is needed.
    this.state = { ...this.state, committed: { ...committed, scrollY: Math.max(0, Math.round(scrollY)) } };
  }

  dismissNotice() {
    if (this.state.notice) this.set({ notice: null });
  }
}
