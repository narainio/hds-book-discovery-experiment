import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { AlertCircle, ArrowRight, Loader2 } from 'lucide-react';
import { assessIntention } from '@workspace/api-client-react';
import { useYourFilter } from '@/hooks/use-your-filter';
import { useModes, useWorkingContext } from '@/hooks/use-working-context';
import { HOME_EXAMPLES } from '@/lib/intention';
import { HomeEntry } from '@/lib/home-entry';
import type { EntryNotice, EntryState } from '@/lib/home-entry';
import { modeSummary } from '@/lib/modes';
import type { ModeDefinition } from '@/lib/modes';
import { contextSummary } from '@/lib/context-summary';

const DRAFT_KEY = 'hds_pf_home_draft';

/** Home draft text is separate from committed query state and survives navigation. */
function readDraft(): string {
  try { return sessionStorage.getItem(DRAFT_KEY) ?? ''; } catch { return ''; }
}
function writeDraft(value: string) {
  try { sessionStorage.setItem(DRAFT_KEY, value); } catch { /* draft is a convenience */ }
}


export default function Home() {
  const [, setLoc] = useLocation();
  const { view } = useYourFilter();
  const { committed, actions } = useWorkingContext();
  const { modes, notice: modesNotice } = useModes();
  const [text, setText] = useState(readDraft);
  const [entryState, setEntryState] = useState<EntryState>({ busy: false, notice: null });
  const { busy, notice } = entryState;
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [modeError, setModeError] = useState<{ id: string; message: string } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const go = () => setLoc('/discover');
  const commitIntention = (value: string) => {
    actions.startIntention(value);
    go();
  };
  // Latest commit callback without recreating the entry controller.
  const commitRef = useRef(commitIntention);
  commitRef.current = commitIntention;
  const [entry] = useState(() => new HomeEntry({
    assess: (value) => assessIntention({ text: value }),
    commit: (value) => commitRef.current(value),
    onChange: setEntryState,
  }));

  useEffect(() => { window.scrollTo(0, 0); }, []);
  useEffect(() => () => entry.cancel(), [entry]);

  const hasWorking = !!committed?.started && !!view;
  // Meaningful active work: words, a book in Filter or "Fewer like this" choices.
  const activeFilter = hasWorking && (!!view?.filter.words || !!view?.filter.book || (view?.session.negativeCount ?? 0) > 0);
  // Continue discovering is shown only when it resumes something Browse all
  // books would not: an active Filter or an actual browsing position.
  const resumable = activeFilter || (hasWorking && (committed?.scrollY ?? 0) > 0);
  const update = (value: string) => {
    setText(value);
    writeDraft(value);
    // Editing retires any assessment in flight and its message.
    entry.cancel();
  };

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    void entry.submit(text);
  };

  const continueWith = (outcome: NonNullable<EntryNotice>) => {
    if (outcome.continueLabel === 'Continue with books' && outcome.continueText) {
      setText(outcome.continueText);
      writeDraft(outcome.continueText);
    }
    void entry.continueWith(outcome);
  };

  const browseAll = () => {
    entry.cancel();
    actions.browseAll();
    go();
  };

  const openMode = async (mode: ModeDefinition) => {
    if (openingId) return;
    entry.cancel();
    setOpeningId(mode.id);
    setModeError(null);
    const result = await actions.openMode(mode);
    setOpeningId(null);
    if (result.ok) go();
    else setModeError({ id: mode.id, message: result.message });
  };

  const editRequest = () => inputRef.current?.focus();

  return (
    <div className="px-4 md:px-8 max-w-[1440px] mx-auto w-full pt-6 md:pt-12">
      <div className="max-w-[760px]">
        <h1 tabIndex={-1} className="text-role-page-title text-foreground focus:outline-none" data-testid="text-home-heading">
          What are you shopping for?
        </h1>
        <p className="mt-1 text-role-metadata text-muted-foreground" data-testid="text-home-scope">Currently exploring books.</p>

        <form onSubmit={submit} className="mt-5 md:mt-6" data-testid="form-home-intention" aria-busy={busy}>
          <label htmlFor="home-intention" className="block text-role-ui text-foreground mb-1.5">
            Describe what you’re looking for
          </label>
          <textarea
            ref={inputRef}
            id="home-intention"
            rows={2}
            value={text}
            maxLength={2000}
            onChange={(e) => update(e.target.value)}
            onKeyDown={(e) => {
              // Enter submits; the composer is one request, not a document.
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(); }
            }}
            placeholder="For example, books for Johnny, age 10, who likes funny mysteries."
            enterKeyHint="search"
            aria-describedby={notice ? 'home-notice' : activeFilter ? 'home-replace-hint' : undefined}
            data-testid="input-home-intention"
            className="block w-full min-h-12 px-3 py-2.5 text-role-ui rounded-lg border-2 border-border bg-card resize-none focus-visible:outline-none focus-visible:border-ring placeholder:text-muted-foreground"
          />
          <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-labelledby="home-examples-label">
            <span id="home-examples-label" className="text-role-small text-muted-foreground mr-0.5">Try:</span>
            {HOME_EXAMPLES.map((example) => (
              <button key={example} type="button" data-testid={`button-example-${example.split(' ')[0].toLowerCase()}`}
                onClick={() => { update(example); inputRef.current?.focus(); }}
                className="min-h-11 px-3 rounded-full border border-border bg-card text-role-small text-foreground hover:border-teal hover:text-teal">
                {example}
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-col sm:flex-row gap-2 sm:items-center">
            <button type="submit" disabled={busy} data-testid="button-find-books"
              className="w-full sm:w-auto min-h-12 px-6 inline-flex items-center justify-center gap-2 rounded-lg bg-teal text-teal-foreground text-role-button hover:opacity-90 disabled:opacity-70 disabled:cursor-wait">
              {busy && <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
              {busy ? 'Finding books…' : 'Find books'}
            </button>
            <button type="button" onClick={browseAll} data-testid="button-browse-all"
              className="w-full sm:w-auto min-h-12 px-5 rounded-lg border border-border bg-card text-role-ui text-foreground hover:bg-secondary">
              Browse all books
            </button>
          </div>
          {activeFilter && !notice && (
            <p id="home-replace-hint" className="mt-2 text-role-small text-muted-foreground" data-testid="text-home-replace-hint">
              Starts a new Filter. Your Cart stays unchanged.
            </p>
          )}
          <p className="sr-only" role="status" aria-live="polite">{busy ? 'Finding books…' : ''}</p>

          {notice && (
            <div id="home-notice" role="alert" className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-3" data-testid="alert-home-notice">
              <p className="flex gap-2 text-role-small text-foreground">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-destructive" aria-hidden="true" />
                <span data-testid="text-home-notice">{notice.message}</span>
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {notice.continueLabel && notice.continueText && (
                  <button type="button" onClick={() => continueWith(notice)} data-testid="button-home-continue"
                    className="min-h-11 px-4 rounded-lg bg-teal text-teal-foreground text-role-button hover:opacity-90">
                    {notice.continueLabel}
                  </button>
                )}
                {notice.retryable && (
                  <button type="button" onClick={() => (notice.failure ? submit() : editRequest())} data-testid="button-home-retry"
                    className="min-h-11 px-4 rounded-lg bg-teal text-teal-foreground text-role-button hover:opacity-90">
                    Try again
                  </button>
                )}
                {notice.offerEdit && (
                  <button type="button" onClick={editRequest} data-testid="button-home-edit"
                    className="min-h-11 px-4 rounded-lg border border-border text-role-ui text-foreground hover:bg-secondary">
                    Edit request
                  </button>
                )}
                {notice.offerBrowse && (
                  <button type="button" onClick={browseAll} data-testid="button-home-notice-browse"
                    className="min-h-11 px-4 rounded-lg border border-border text-role-ui text-foreground hover:bg-secondary">
                    Browse all books
                  </button>
                )}
              </div>
            </div>
          )}

        </form>

        {resumable && (
          <section className="mt-8 border-t border-border pt-5" aria-label="Your current discovery">
            <Link href="/discover" data-testid="link-continue-discovering"
              className="group flex items-center justify-between gap-4 rounded-lg border border-border bg-card px-4 py-3 hover:border-teal">
              <span className="min-w-0">
                <span className="block text-role-ui font-semibold text-foreground group-hover:text-teal">
                  Continue discovering
                </span>
                <span className="block text-role-small text-muted-foreground truncate" data-testid="text-continue-summary">
                  {contextSummary(committed, view?.filter ?? null, view?.session.negativeCount ?? 0)}
                </span>
              </span>
              <ArrowRight className="w-5 h-5 text-muted-foreground shrink-0 group-hover:text-teal" aria-hidden="true" />
            </Link>
          </section>
        )}

        <section className={`${resumable ? 'mt-8' : 'mt-10 border-t border-border pt-6'}`} aria-labelledby="your-modes-heading">
          <h2 id="your-modes-heading" className="text-role-section-title text-foreground">Your Modes</h2>
          {modesNotice && <p className="mt-2 text-role-small text-muted-foreground" data-testid="text-modes-notice">{modesNotice}</p>}
          {modes.length === 0 ? (
            <div className="mt-2" data-testid="text-modes-empty">
              <p className="text-role-body text-foreground">No saved Modes yet.</p>
              <p className="text-role-small text-muted-foreground">You can save a Filter while discovering.</p>
            </div>
          ) : (
            <ul className="mt-3 divide-y divide-border border-y border-border" data-testid="list-modes">
              {modes.map((mode) => (
                <li key={mode.id} data-testid={`row-mode-${mode.id}`}>
                  {/* One interactive element per row; "Open" is a visual cue, not a second control. */}
                  <button type="button" onClick={() => void openMode(mode)} disabled={!!openingId}
                    aria-busy={openingId === mode.id || undefined}
                    data-testid={`button-open-mode-${mode.id}`}
                    className="group w-full min-h-11 py-3 px-2 flex items-center gap-3 rounded-lg text-left hover:bg-secondary disabled:opacity-60 disabled:cursor-wait">
                    <span className="min-w-0 flex-1">
                      <span className="block text-role-ui font-semibold text-foreground break-words group-hover:text-teal">{mode.name}</span>
                      <span className="block text-role-small text-muted-foreground break-words">{modeSummary(mode)}</span>
                    </span>
                    <span aria-hidden="true" className="shrink-0 inline-flex items-center gap-1.5 text-role-ui text-teal">
                      {openingId === mode.id
                        ? <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" />
                        : <>Open <ArrowRight className="w-4 h-4" /></>}
                    </span>
                  </button>
                  {modeError?.id === mode.id && (
                    <p role="alert" className="pb-3 text-role-small text-destructive">{modeError.message}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
