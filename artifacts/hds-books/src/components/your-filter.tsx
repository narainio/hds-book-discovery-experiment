import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { AlertCircle, BookOpen, Loader2, Pencil, RotateCw, X } from 'lucide-react';
import { useYourFilter } from '@/hooks/use-your-filter';
import { filterKind, normalizeWords } from '@/lib/filter-controller';
import type { FilterInput } from '@/lib/filter-controller';

const TITLES = {
  empty: 'Nothing added yet',
  book: '1 book shaping these results',
  words: 'Your direction shapes these results',
  both: 'A direction and 1 example shape these results',
} as const;

const EXPLANATIONS = {
  empty: null,
  book: 'Adding a direction keeps the book.',
  words: 'Changing your direction does not add a book. You can also use a book below as an example.',
  both: 'Removing the book keeps your direction. Changing your direction keeps the book.',
} as const;

function pendingText(pending: FilterInput | null, visible: FilterInput | null): string {
  if (!pending) return '';
  if ((pending.book?.id ?? null) !== (visible?.book?.id ?? null)) {
    return pending.book ? `Using "${pending.book.title}" as an example. Updating results...` : 'Removing the book. Updating results...';
  }
  return normalizeWords(pending.words) ? 'Applying your direction. Updating results...' : 'Clearing your direction. Updating results...';
}

export function YourFilter({ variant = 'full' }: { variant?: 'full' | 'compact' }) {
  const { view, pending, error, announcement, draft, status, controller } = useYourFilter();
  const filter = view?.filter ?? null;
  const kind = filterKind(filter);
  const words = normalizeWords(filter?.words);
  const isPending = status === 'pending' || !!pending;
  const blocked = error?.kind === 'unsynced';
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the edit field open (with the draft) if an update fails.
  useEffect(() => {
    if (error?.kind === 'update' && normalizeWords(error.failed?.words) !== words) setEditing(true);
  }, [error, words]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const showInput = !words || editing;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next = normalizeWords(draft);
    if (!next) {
      if (words) controller.clearWords();
      setEditing(false);
      return;
    }
    controller.setWords(next);
    setEditing(false);
  };

  const cancelEdit = () => {
    controller.setDraft(words ?? '');
    setEditing(false);
  };

  const compact = variant === 'compact';

  return (
    <section
      id="your-filter"
      tabIndex={-1}
      aria-labelledby="your-filter-heading"
      aria-busy={isPending}
      data-testid="panel-your-filter"
      className={`w-full bg-card border border-border rounded-lg shadow-sm scroll-mt-24 focus-visible:outline-2 ${compact ? 'p-3 md:p-4' : 'p-4 md:p-5'}`}
    >
      <div className="flex items-start justify-between gap-3 mb-1">
        <h2 id="your-filter-heading" className="text-role-ui font-sans text-muted-foreground">Your Filter</h2>
        {isPending && (
          <span className="flex items-center gap-1.5 text-role-small text-teal" data-testid="status-filter-pending">
            <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            Updating
          </span>
        )}
      </div>
      <p className="text-role-card-title text-foreground mb-3" data-testid="text-filter-title">{TITLES[kind]}</p>

      {/* Live status: pending immediately, success only once matching results arrived */}
      <p className="sr-only" role="status" aria-live="polite" data-testid="status-filter-live">
        {isPending ? pendingText(pending, filter) : announcement}
      </p>
      {isPending && (
        <p className="text-role-small text-muted-foreground mb-3" aria-hidden="true">{pendingText(pending, filter)}</p>
      )}

      {error && (
        <div role="alert" className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 p-3" data-testid="alert-filter-error">
          <p className="flex gap-2 text-role-small text-foreground">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-destructive" aria-hidden="true" />
            <span><span className="font-semibold">Not applied.</span> {error.message}</span>
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={() => controller.retry()} data-testid="button-filter-retry"
              className="min-h-11 px-4 inline-flex items-center gap-2 rounded-lg bg-teal text-teal-foreground text-role-button hover:opacity-90">
              <RotateCw className="w-4 h-4" aria-hidden="true" /> Retry
            </button>
            {!blocked && <button type="button" onClick={() => controller.dismissError()} data-testid="button-filter-dismiss"
              className="min-h-11 px-4 rounded-lg border border-border text-role-ui text-foreground hover:bg-secondary">
              Dismiss
            </button>}
          </div>
        </div>
      )}

      {/* Example book */}
      {filter?.book && (
        <div className="mb-3 rounded-md border border-teal/20 bg-teal/5 p-2 flex flex-col gap-1" data-testid="block-filter-book">
          <div className="flex items-start gap-3">
          {filter.book.coverImageUrl ? (
            <img src={filter.book.coverImageUrl} alt="" className="w-10 h-14 object-contain bg-background rounded-sm shrink-0" />
          ) : (
            <div className="w-10 h-14 bg-background border border-border rounded-sm flex items-center justify-center shrink-0">
              <BookOpen className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-role-metadata text-foreground font-semibold break-words" data-testid="text-filter-book-title">{filter.book.title}</p>
            <p className="text-role-small text-muted-foreground">Using as an example · not a required match</p>
          </div>
          </div>
          <button type="button" onClick={() => controller.removeBook()} data-testid="button-remove-book" disabled={blocked}
            className="self-end min-h-11 px-3 inline-flex items-center gap-1 rounded-md text-role-ui text-foreground hover:bg-secondary disabled:opacity-50 disabled:cursor-not-allowed">
            <X className="w-4 h-4" aria-hidden="true" /> Remove book
          </button>
        </div>
      )}

      {/* Direction */}
      {words && !editing && (
        <div className="mb-3 rounded-md border border-border bg-background/60 p-3" data-testid="block-filter-words">
          <p className="text-role-small text-muted-foreground mb-0.5">Your direction</p>
          <p className="text-role-body text-foreground break-words" data-testid="text-filter-words">{words}</p>
          <div className="mt-1 flex flex-wrap gap-1 -ml-2">
            <button type="button" onClick={() => { controller.setDraft(words); setEditing(true); }} data-testid="button-edit-direction" disabled={blocked}
              className="min-h-11 px-2 inline-flex items-center gap-1.5 rounded-md text-role-ui text-teal hover:bg-secondary">
              <Pencil className="w-4 h-4" aria-hidden="true" /> Edit direction
            </button>
            <button type="button" onClick={() => controller.clearWords()} data-testid="button-clear-direction" disabled={blocked}
              className="min-h-11 px-2 inline-flex items-center gap-1.5 rounded-md text-role-ui text-foreground hover:bg-secondary">
              <X className="w-4 h-4" aria-hidden="true" /> Clear direction
            </button>
          </div>
        </div>
      )}

      {showInput && (!compact || editing) && (
        <form onSubmit={submit} className="mb-3" data-testid="form-filter-words">
          <label htmlFor="filter-words" className="block text-role-ui text-foreground mb-1.5">
            {words || filter?.book ? 'Add or change your direction' : 'Describe what you\u2019re looking for (optional)'}
          </label>
          <input
            ref={inputRef}
            id="filter-words"
            type="text"
            value={draft}
            onChange={(e) => controller.setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape' && words) cancelEdit(); }}
            placeholder="Try “Funny mysteries, not too scary”"
            data-testid="input-filter-words"
            className="w-full h-12 px-3 text-role-ui rounded-lg border-2 border-border bg-background focus-visible:outline-none focus-visible:border-ring placeholder:text-muted-foreground"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="submit" disabled={blocked || (!normalizeWords(draft) && !words)} data-testid="button-apply-direction"
              className="min-h-11 px-4 rounded-lg bg-teal text-teal-foreground text-role-button hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed">
              {words ? 'Update direction' : 'Apply direction'}
            </button>
            {words && (
              <button type="button" onClick={cancelEdit} data-testid="button-cancel-direction"
                className="min-h-11 px-4 rounded-lg border border-border text-role-ui text-foreground hover:bg-secondary">
                Cancel
              </button>
            )}
          </div>
        </form>
      )}

      {kind === 'empty' && (
        <p className="text-role-small text-muted-foreground" data-testid="text-filter-empty-hint">
          {compact ? (
            <>Nothing added yet. <Link href="/" className="text-teal underline underline-offset-2">Describe what you’re looking for</Link>, or use a book to shape results.</>
          ) : 'Or use a book below to shape these results.'}
        </p>
      )}
      {kind !== 'empty' && (
        <p className="text-role-small text-muted-foreground" data-testid="text-filter-explanation">
          {EXPLANATIONS[kind]}{' '}
          {compact && <Link href="/" className="text-teal underline underline-offset-2">See results</Link>}
        </p>
      )}
    </section>
  );
}
