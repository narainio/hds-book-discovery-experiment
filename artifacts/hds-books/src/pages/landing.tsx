import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { AlertCircle, ArrowRight, ArrowUp, Loader2, Mic, Plus } from 'lucide-react';
import { assessIntention } from '@workspace/api-client-react';
import { useWorkingContext } from '@/hooks/use-working-context';
import { HomeEntry } from '@/lib/home-entry';
import type { EntryNotice, EntryState } from '@/lib/home-entry';
import { DEMO_USER, FEATURED, TILES } from '@/lib/demo-content';
import { greetingFor } from '@/lib/demo-time';
import { ComingSoonButton } from '@/components/coming-soon';
import { FallbackImage } from '@/components/fallback-image';

export const DRAFT_KEY = 'hds_pf_home_draft';

/** Draft text is separate from committed query state and survives navigation. */
function readDraft(): string {
  try { return sessionStorage.getItem(DRAFT_KEY) ?? ''; } catch { return ''; }
}
function writeDraft(value: string) {
  try { sessionStorage.setItem(DRAFT_KEY, value); } catch { /* draft is a convenience */ }
}

const pillBtn = 'min-h-11 px-5 inline-flex items-center gap-2 rounded-full text-role-button';

export default function Landing() {
  const [, setLoc] = useLocation();
  const { actions } = useWorkingContext();
  const [text, setText] = useState(readDraft);
  const [entryState, setEntryState] = useState<EntryState>({ busy: false, notice: null });
  const { busy, notice } = entryState;
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const [greeting] = useState(() => greetingFor(new Date()));

  const go = () => setLoc('/discover');
  const commitRef = useRef((value: string) => { actions.startIntention(value); go(); });
  commitRef.current = (value: string) => { actions.startIntention(value); go(); };
  const [entry] = useState(() => new HomeEntry({
    assess: (value) => assessIntention({ text: value }),
    commit: (value) => commitRef.current(value),
    onChange: setEntryState,
  }));

  useEffect(() => { if (typeof window !== 'undefined') window.scrollTo(0, 0); }, []);
  useEffect(() => () => entry.cancel(), [entry]);

  const update = (value: string) => { setText(value); writeDraft(value); entry.cancel(); };
  const submit = (e?: React.FormEvent) => { e?.preventDefault(); void entry.submit(text); };
  const continueWith = (outcome: NonNullable<EntryNotice>) => {
    if (outcome.continueLabel === 'Continue with books' && outcome.continueText) {
      setText(outcome.continueText); writeDraft(outcome.continueText);
    }
    void entry.continueWith(outcome);
  };
  const browseAll = () => { entry.cancel(); actions.browseAll(); go(); };

  return (
    <div className="w-full">
      <section className="px-4 md:px-8 pt-10 md:pt-16 pb-8 md:pb-12 text-center animate-in fade-in slide-in-from-bottom-2 duration-500 motion-reduce:animate-none">
        <h1 tabIndex={-1} className="text-role-page-title text-foreground focus:outline-none" data-testid="text-greeting">
          {greeting}, {DEMO_USER.firstName}.
        </h1>
        <form onSubmit={submit} className="mt-6 md:mt-8 mx-auto max-w-[700px]" data-testid="form-home-intention" aria-busy={busy}>
          <label htmlFor="home-intention" className="sr-only">Ask anything</label>
          <div className="flex items-center gap-1 rounded-full border-2 border-input bg-card px-2.5 h-[68px] transition-[border-color,box-shadow] duration-200 motion-reduce:transition-none shadow-[0_6px_24px_-12px_hsl(var(--primary)/0.25)] focus-within:border-ring">
            <ComingSoonButton feature="Adding photos and files" aria-label="Add photos and files" data-testid="button-ask-plus"
              className="shrink-0 w-11 h-11 rounded-full inline-flex items-center justify-center text-foreground hover:bg-secondary">
              <Plus className="w-5 h-5" aria-hidden="true" />
            </ComingSoonButton>
            <span aria-hidden="true" className="h-6 w-px bg-border" />
            <input
              ref={inputRef}
              id="home-intention"
              type="text"
              value={text}
              maxLength={2000}
              onChange={(e) => update(e.target.value)}
              placeholder="Ask anything…"
              enterKeyHint="search"
              autoComplete="off"
              aria-describedby={notice ? 'home-notice home-scope' : 'home-scope'}
              data-testid="input-home-intention"
              className="min-w-0 flex-1 h-11 px-3 bg-transparent text-role-body-large text-foreground focus-visible:outline-none placeholder:text-muted-foreground"
            />
            <span aria-hidden="true" className="h-6 w-px bg-border" />
            <ComingSoonButton feature="Voice input" aria-label="Voice input" data-testid="button-ask-mic"
              className="shrink-0 w-11 h-11 rounded-full inline-flex items-center justify-center text-foreground hover:bg-secondary">
              <Mic className="w-5 h-5" aria-hidden="true" />
            </ComingSoonButton>
            <button type="submit" disabled={busy} aria-label="Ask" data-testid="button-find-books"
              className="shrink-0 w-11 h-11 rounded-full inline-flex items-center justify-center bg-teal text-teal-foreground hover:bg-teal/90 disabled:cursor-wait">
              {busy ? <Loader2 className="w-5 h-5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <ArrowUp className="w-5 h-5" aria-hidden="true" />}
            </button>
          </div>
          <p id="home-scope" className="mt-3 text-role-small text-muted-foreground" data-testid="text-home-scope">Currently exploring books.</p>
          <p className="sr-only" role="status" aria-live="polite">{busy ? 'Finding books…' : ''}</p>

          {notice && (
            <div id="home-notice" role="alert" className="mt-3 text-left rounded-xl border border-destructive/40 bg-destructive/5 p-3" data-testid="alert-home-notice">
              <p className="flex gap-2 text-role-small text-foreground">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-destructive" aria-hidden="true" />
                <span data-testid="text-home-notice">{notice.message}</span>
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {notice.continueLabel && notice.continueText && (
                  <button type="button" onClick={() => continueWith(notice)} data-testid="button-home-continue" className={`${pillBtn} bg-teal text-teal-foreground hover:bg-teal/90`}>
                    {notice.continueLabel}
                  </button>
                )}
                {notice.retryable && (
                  <button type="button" onClick={() => (notice.failure ? submit() : inputRef.current?.focus())} data-testid="button-home-retry" className={`${pillBtn} bg-teal text-teal-foreground hover:bg-teal/90`}>
                    Try again
                  </button>
                )}
                {notice.offerEdit && (
                  <button type="button" onClick={() => inputRef.current?.focus()} data-testid="button-home-edit" className={`${pillBtn} border-2 border-input text-foreground hover:bg-secondary`}>
                    Edit request
                  </button>
                )}
                {notice.offerBrowse && (
                  <button type="button" onClick={browseAll} data-testid="button-home-notice-browse" className={`${pillBtn} border-2 border-input text-foreground hover:bg-secondary`}>
                    Browse all books
                  </button>
                )}
              </div>
            </div>
          )}
        </form>
      </section>

      <hr className="border-0 h-[2px] bg-rule" style={{ backgroundColor: 'hsl(var(--rule))' }} />

      <section aria-label="Featured" className="px-4 md:px-8 pt-6 md:pt-8 grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
        {FEATURED.map((card) => (
          <article key={card.id} data-testid={`card-featured-${card.id}`}
            className="relative overflow-hidden rounded-xl border border-card-border bg-secondary min-h-[200px] md:min-h-[230px] grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="relative z-10 p-5 md:p-6 flex flex-col">
              <p className="text-role-small font-semibold uppercase tracking-wide text-muted-foreground">{card.eyebrow}</p>
              <h2 className="mt-1 text-role-subsection-title text-foreground">{card.title}</h2>
              <p className="mt-1 text-role-metadata text-muted-foreground">{card.subtext}</p>
              <div className="mt-auto pt-4">
                <ComingSoonButton feature={card.feature} data-testid={`button-featured-${card.id}`}
                  className={`${pillBtn} ${card.variant === 'primary' ? 'bg-teal text-teal-foreground hover:bg-teal/90' : 'border-2 border-primary text-foreground bg-card hover:bg-secondary'}`}>
                  {card.cta} <ArrowRight className="w-4 h-4" aria-hidden="true" />
                </ComingSoonButton>
              </div>
            </div>
            <FallbackImage src={card.image} alt={card.alt} color={card.fallback} className="h-full w-full object-cover" />
          </article>
        ))}
      </section>

      <section aria-label="Shop by category" className="relative pt-4 md:pt-5">
        <div ref={rowRef} className="scrollbar-none flex gap-3 overflow-x-auto snap-x snap-mandatory px-4 md:px-8 md:pr-20 pb-2" data-testid="row-tiles">
          {TILES.map((tile) => (
            <ComingSoonButton key={tile.id} feature={tile.title} data-testid={`button-tile-${tile.id}`}
              className="snap-start shrink-0 w-[220px] md:w-[248px] min-h-[84px] flex items-center gap-3 rounded-xl border border-card-border bg-card p-2 pr-3 text-left hover:border-input">
              <FallbackImage src={tile.image} alt="" color={tile.fallback} className="w-[72px] h-[68px] rounded-lg object-cover shrink-0" />
              <span className="min-w-0">
                <span className="block text-role-ui font-semibold text-foreground">{tile.title}</span>
                <span className="block text-role-small text-muted-foreground">{tile.sub}</span>
              </span>
            </ComingSoonButton>
          ))}
        </div>
        <button type="button" aria-label="Scroll categories" data-testid="button-tiles-next"
          onClick={() => rowRef.current?.scrollBy({ left: 280, behavior: 'smooth' })}
          className="hidden md:inline-flex absolute right-6 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full border-2 border-input bg-card items-center justify-center text-foreground shadow-sm hover:bg-secondary">
          <ArrowRight className="w-5 h-5" aria-hidden="true" />
        </button>
      </section>
    </div>
  );
}
