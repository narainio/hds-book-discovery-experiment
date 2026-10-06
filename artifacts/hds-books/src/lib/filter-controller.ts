import type {
  BookThumb,
  DiscoverResponse,
  SessionState,
} from '@workspace/api-client-react';

/**
 * Shopper-supplied Filter inputs for the product-as-filter experiment.
 * Exactly zero or one example book, and zero or one written direction.
 * `promptId` is request metadata only and never part of identity.
 */
export interface FilterInput {
  words: string | null;
  book: BookThumb | null;
  promptId?: string;
}

export interface FilterResult {
  session: SessionState;
  discover: DiscoverResponse;
}

/** A coherent committed view: the Filter and the results that belong to it. */
export interface FilterView extends FilterResult {
  filter: FilterInput;
}

export type FilterStatus = 'loading' | 'ready' | 'pending' | 'load-error';

export interface FilterError {
  /** unsynced: server state could not be confirmed; changes are blocked until retry. */
  kind: 'update' | 'load' | 'unsynced';
  message: string;
  failed: FilterInput | null;
}

export interface FilterSnapshot {
  status: FilterStatus;
  view: FilterView | null;
  /** Latest requested inputs that have not yet arrived with matching results. */
  pending: FilterInput | null;
  error: FilterError | null;
  /** Polite live-region text; only set once matching results have arrived. */
  announcement: string;
  /** Draft words survive failures, navigation, and pending updates. */
  draft: string;
  /** "Show more books" pagination for the committed view. */
  more: 'idle' | 'loading' | 'error';
}

export interface FilterAdapter {
  /** Apply a full desired Filter and return the coherent session + results. */
  commit: (desired: FilterInput) => Promise<FilterResult>;
  /** Read the current server state and results without writing anything. */
  read: () => Promise<FilterResult>;
  /** Read a further page of the committed results (read-only). */
  readPage?: (offset: number) => Promise<FilterResult>;
  onResult?: (result: FilterResult) => void;
}

export const EMPTY_FILTER: FilterInput = { words: null, book: null };

export function normalizeWords(words: string | null | undefined): string | null {
  const trimmed = (words ?? '').replace(/\s+/g, ' ').trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function sameFilter(a: FilterInput | null, b: FilterInput | null): boolean {
  if (!a || !b) return a === b;
  return normalizeWords(a.words) === normalizeWords(b.words)
    && (a.book?.id ?? null) === (b.book?.id ?? null);
}

/** The server-reported Filter that the arrived results were ranked with. */
export function filterFromResult(result: FilterResult): FilterInput {
  const shaping = result.discover.shaping ?? result.session.shaping;
  return {
    words: normalizeWords(shaping.query),
    book: shaping.pivot
      ? { id: shaping.pivot.id, title: shaping.pivot.title, coverImageUrl: shaping.pivot.coverImageUrl ?? null }
      : null,
  };
}

export function filterKind(filter: FilterInput | null): 'empty' | 'book' | 'words' | 'both' {
  const words = !!normalizeWords(filter?.words);
  const book = !!filter?.book;
  if (words && book) return 'both';
  if (book) return 'book';
  if (words) return 'words';
  return 'empty';
}

export function resultsHeading(filter: FilterInput | null): string {
  switch (filterKind(filter)) {
    case 'both': return 'Books shaped by your direction and example';
    case 'book': return 'Books shaped by your example';
    case 'words': return 'Books shaped by your direction';
    default: return 'Books to explore';
  }
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'status' in error) {
    const status = Number((error as { status: unknown }).status);
    if (status >= 500) return 'The server could not apply that change.';
    if (status === 404) return 'That book or session could not be found.';
    if (status >= 400) return 'That change was rejected.';
  }
  return 'We could not reach the server.';
}

type Listener = () => void;

/**
 * Serialized Filter controller. One request is in flight at a time; newer
 * requests supersede queued intermediate ones. The visible view only changes
 * when a complete result arrives, so results never claim inputs they were not
 * ranked with. Failures keep the last working view and the draft, then
 * reconcile against a read-only fetch of the server state.
 */
export class FilterController {
  private snapshot: FilterSnapshot = {
    status: 'loading',
    view: null,
    pending: null,
    error: null,
    announcement: '',
    draft: '',
    more: 'idle',
  };
  private needsRefresh = false;
  private listeners = new Set<Listener>();
  private target: FilterInput | null = null;
  private running = false;
  private loadToken = 0;

  constructor(private adapter: FilterAdapter) {}

  setAdapter(adapter: FilterAdapter) {
    this.adapter = adapter;
  }

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = () => this.snapshot;

  private set(patch: Partial<FilterSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((l) => l());
  }

  /** The inputs the next change should build on: queued intent, else visible. */
  get base(): FilterInput {
    return this.target ?? this.snapshot.view?.filter ?? EMPTY_FILTER;
  }

  async load(): Promise<void> {
    const token = ++this.loadToken;
    this.set({ status: this.snapshot.view ? this.snapshot.status : 'loading', error: null });
    try {
      const result = await this.adapter.read();
      if (token !== this.loadToken || this.running) return;
      this.applyView(result);
      const filter = filterFromResult(result);
      this.set({
        status: 'ready',
        draft: this.snapshot.draft || filter.words || '',
      });
    } catch (error) {
      if (token !== this.loadToken) return;
      this.set({
        status: this.snapshot.view ? 'ready' : 'load-error',
        error: { kind: 'load', message: `Results could not be loaded. ${errorMessage(error)}`, failed: null },
      });
    }
  }

  /**
   * Re-read committed results after a non-Filter signal (e.g. "fewer like
   * this"). Serialized behind any in-flight Filter change.
   */
  refresh() {
    if (this.running) {
      this.needsRefresh = true;
      return;
    }
    void this.load();
  }

  /**
   * Append the next page of the committed view. Pages are only appended when
   * they were ranked with the same Filter and ranking version; otherwise the
   * view is re-read. On failure, existing results stay and retry is offered.
   */
  async loadMore(): Promise<void> {
    const view = this.snapshot.view;
    const readPage = this.adapter.readPage;
    if (!view || !readPage || !view.discover.hasMore || this.snapshot.more === 'loading' || this.running) return;
    this.set({ more: 'loading' });
    try {
      const page = await readPage(view.discover.results.length);
      const current = this.snapshot.view;
      if (current !== view) return; // superseded by a Filter change or refresh
      const matches = sameFilter(filterFromResult(page), view.filter)
        && page.discover.rankingVersion === view.discover.rankingVersion;
      if (!matches) {
        this.set({ more: 'idle' });
        void this.load();
        return;
      }
      const seen = new Set(view.discover.results.map((r) => r.book.id));
      const results = [...view.discover.results, ...page.discover.results.filter((r) => !seen.has(r.book.id))];
      this.set({
        view: {
          ...view,
          session: page.session,
          discover: { ...view.discover, results, resultCount: results.length, hasMore: page.discover.hasMore },
        },
        more: 'idle',
      });
    } catch {
      if (this.snapshot.view === view) this.set({ more: 'error' });
    }
  }

  setDraft(draft: string) {
    this.set({ draft });
  }

  setWords(words: string | null, promptId?: string) {
    const next = { ...this.base, words: normalizeWords(words), promptId };
    if (next.words) this.set({ draft: next.words });
    this.request(next);
  }

  clearWords() {
    this.set({ draft: '' });
    this.request({ ...this.base, words: null, promptId: undefined });
  }

  /** Selecting the active example again is idempotent. */
  setBook(book: BookThumb) {
    if (this.base.book?.id === book.id) return;
    this.request({ ...this.base, book, promptId: undefined });
  }

  removeBook() {
    this.request({ ...this.base, book: null, promptId: undefined });
  }

  retry() {
    const error = this.snapshot.error;
    if (!error) return;
    if (error.kind === 'load' || !error.failed) {
      void this.load();
      return;
    }
    this.request(error.failed, true);
  }

  dismissError() {
    if (this.isBlocked) return;
    this.set({ error: null });
  }

  get isBlocked(): boolean {
    return this.snapshot.error?.kind === 'unsynced';
  }

  private request(next: FilterInput, force = false) {
    if (this.isBlocked && !force) return;
    const visible = this.snapshot.view?.filter ?? null;
    if (!this.running && sameFilter(next, visible) && !next.promptId) {
      this.target = null;
      this.set({ pending: null, error: null });
      return;
    }
    this.target = next;
    this.set({ pending: next, error: null, announcement: '', status: 'pending' });
    if (!this.running) void this.run();
  }

  private applyView(result: FilterResult) {
    this.adapter.onResult?.(result);
    this.set({ view: { ...result, filter: filterFromResult(result) }, more: 'idle' });
  }

  private async run() {
    this.running = true;
    this.loadToken++;
    while (this.target) {
      const attempt = this.target;
      try {
        const result = await this.adapter.commit(attempt);
        this.applyView(result);
        this.set({ error: null });
        if (this.target === attempt) this.target = null;
      } catch (error) {
        if (this.target !== attempt) continue; // a newer intent supersedes the failed one
        this.target = null;
        const synced = await this.reconcile();
        this.set({
          error: synced
            ? {
                kind: 'update',
                message: `That change was not applied. ${errorMessage(error)} Your previous Filter and results are still shown.`,
                failed: attempt,
              }
            : {
                kind: 'unsynced',
                message: `That change was not applied, and we could not confirm your saved Filter. ${errorMessage(error)} Retry before making more changes.`,
                failed: attempt,
              },
        });
        if (synced && this.target) continue; // shopper made another change during reconcile
        this.target = null;
        break;
      }
    }
    this.running = false;
    if (this.needsRefresh) {
      this.needsRefresh = false;
      void this.load();
    }
    const view = this.snapshot.view;
    this.set({
      status: 'ready',
      pending: null,
      announcement: !this.snapshot.error && view
        ? `Results updated. ${resultsHeading(view.filter)}.`
        : this.snapshot.announcement,
    });
  }

  /**
   * After a failure, make the server match the last working visible Filter so
   * a failed update is never silently shown or silently persisted. Returns
   * false when that cannot be confirmed.
   */
  private async reconcile(): Promise<boolean> {
    const visible = this.snapshot.view?.filter ?? null;
    try {
      const server = await this.adapter.read();
      if (!visible) {
        this.applyView(server);
        return true;
      }
      if (sameFilter(filterFromResult(server), visible)) return true;
      // The update persisted but its results did not reach us: restore.
      const restored = await this.adapter.commit(visible);
      this.applyView(restored);
      return sameFilter(filterFromResult(restored), visible);
    } catch {
      return false;
    }
  }
}
