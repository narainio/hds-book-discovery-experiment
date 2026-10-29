import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AlertCircle, BookOpen, Loader2, Pencil, RotateCw, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { assessIntention } from '@workspace/api-client-react';
import { useYourFilter } from '@/hooks/use-your-filter';
import { useWorkingContext } from '@/hooks/use-working-context';
import { normalizeWords } from '@/lib/filter-controller';
import type { FilterInput } from '@/lib/filter-controller';
import { MAX_WORDS_LENGTH } from '@/lib/filter-api';
import {
  UNINTERPRETABLE_MESSAGE,
  assessmentOutcome,
  composeQuery,
  preferenceLabels,
  refinementOutcome,
  suggestModeName,
  visibleSuggestions,
} from '@/lib/intention';
import type { AssessmentOutcome } from '@/lib/intention';
import { SaveModeDialog } from '@/components/save-mode-dialog';

function pendingText(pending: FilterInput | null, visible: FilterInput | null): string {
  if (!pending) return '';
  if (pending.clearNegatives) return 'Finding books…';
  if ((pending.book?.id ?? null) !== (visible?.book?.id ?? null)) {
    return pending.book ? `Adding "${pending.book.title}" to your Filter. Updating results...` : 'Removing the book from your Filter. Updating results...';
  }
  return normalizeWords(pending.words) ? 'Updating your Filter. Updating results...' : 'Clearing your words. Updating results...';
}

/** Distance (px) past the ribbon's top before it may collapse. */
const COLLAPSE_AFTER = 48;

/**
 * The single Filter ribbon: one component and one state source for desktop
 * and mobile. Expanded for editing at the top of the page; compact and sticky
 * while browsing, unless focus is inside or the shopper chose Edit.
 * Drafts live in the Filter controller, so they survive collapse,
 * expansion, failures, and navigation.
 */
export function YourFilter({ forceExpanded = false }: { forceExpanded?: boolean }) {
  const { view, pending, error, announcement, status, controller } = useYourFilter();
  const { committed, notice, store, actions, effective } = useWorkingContext();
  const filter = view?.filter ?? null;
  const words = normalizeWords(filter?.words);
  const book = filter?.book ?? null;
  const isPending = status === 'pending' || !!pending;
  const blocked = error?.kind === 'unsynced';
  // The context record matches the committed words; otherwise show the words as the intention.
  const ctxMatches = normalizeWords(effective) === words;
  const base = ctxMatches ? committed?.base ?? null : words;
  const refinements = ctxMatches ? committed?.refinements ?? [] : [];
  const sourceModeName = ctxMatches ? committed?.sourceModeName ?? null : null;

  const sentinelRef = useRef<HTMLDivElement>(null);
  const ribbonRef = useRef<HTMLElement>(null);
  const editRef = useRef<HTMLInputElement>(null);
  const refineRef = useRef<HTMLInputElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [spacer, setSpacer] = useState(0);
  const expandedHeight = useRef(0);

  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [editNotice, setEditNotice] = useState<Extract<AssessmentOutcome, { kind: 'blocked' }> | null>(null);
  const [refineText, setRefineText] = useState('');
  const [refineNotice, setRefineNotice] = useState<string | null>(null);
  const [refineTarget, setRefineTarget] = useState<string | null>(null);
  const [checking, setChecking] = useState<'edit' | 'refine' | null>(null);
  const [confirmStartOver, setConfirmStartOver] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const checkToken = useRef(0);

  const { data: assessment } = useQuery({
    queryKey: ['intention-assessment', words],
    queryFn: () => assessIntention({ text: words ?? '' }),
    enabled: !!words,
    staleTime: Infinity,
    retry: false,
  });
  const preferences = words ? preferenceLabels(view?.discover.interpretation) : [];
  const caveats = words && assessment?.text === words ? assessment.caveats.slice(0, 3) : [];
  const suggestions = visibleSuggestions(words);

  // A refinement's text stays in its field until results that include it arrive.
  useEffect(() => {
    if (refineTarget && normalizeWords(refineTarget) === words) {
      setRefineText('');
      setRefineTarget(null);
    }
  }, [words, refineTarget]);

  // Any newer committed change retires the save confirmation.
  useEffect(() => { setSaved(null); }, [words, book?.id]);

  const compact = !forceExpanded && scrolled && !focusWithin && !manualOpen && !dialogOpen && !editing;

  // Detect browsing past the ribbon's resting position (below the measured navigation).
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    let frame = 0;
    const check = () => {
      frame = 0;
      const nav = parseFloat(getComputedStyle(sentinel).getPropertyValue('--top-navigation-height')) || 0;
      const past = sentinel.getBoundingClientRect().top < nav - COLLAPSE_AFTER;
      setScrolled(past);
      if (!past) setManualOpen(false);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(check); };
    check();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  // Height bookkeeping, run before paint on every state change:
  // - Auto collapse/expand at the scroll threshold: a spacer above the sticky
  //   ribbon absorbs the height difference so the page does not jump.
  // - Edit/Done/focus changes while browsing deep: the spacer is held
  //   constant, so the ribbon's added height enters normal flow and the row
  //   under it moves down by exactly that amount (anchor compensation) instead
  //   of being covered; collapsing reverses it with no net scroll change.
  // - scrollPaddingTop always includes the full current ribbon height, so
  //   focused controls and anchors land below it.
  const heldSpacer = useRef(0);
  useLayoutEffect(() => {
    const ribbon = ribbonRef.current;
    if (!ribbon) return;
    const root = document.documentElement;

    const measure = () => {
      const height = ribbon.getBoundingClientRect().height;
      // Learn the resting expanded height only at the top of the page.
      if (!compact && !scrolled) expandedHeight.current = height;
      if (!scrolled) heldSpacer.current = 0;
      else if (compact) heldSpacer.current = Math.max(0, expandedHeight.current - height);
      // Expanded while browsing: keep the spacer from the compact state.
      setSpacer(heldSpacer.current);
      const nav = parseFloat(getComputedStyle(ribbon).getPropertyValue('--top-navigation-height')) || 0;
      // An editor taller than the available screen scrolls with the document
      // until its bottom is reachable; never create a second vertical scroller.
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      ribbon.style.top = `${Math.min(nav, viewportHeight - height)}px`;
      root.style.scrollPaddingTop = `${Math.round(nav + height + 16)}px`;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(ribbon);
    window.visualViewport?.addEventListener('resize', measure);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.visualViewport?.removeEventListener('resize', measure);
      window.removeEventListener('resize', measure);
    };
  }, [compact, scrolled]);

  useEffect(() => () => { document.documentElement.style.scrollPaddingTop = ''; }, []);

  const openEditor = () => {
    setManualOpen(true);
    requestAnimationFrame(() => (refineRef.current ?? editButtonRef.current)?.focus({ preventScroll: true }));
  };

  // Focusing Edit must not replace it before its click/Enter event fires.
  // Only the expanded editor locks itself open while it contains focus.
  const onFocus = () => { if (!compact) setFocusWithin(true); };
  const onBlur = (e: React.FocusEvent) => {
    if (ribbonRef.current?.contains(e.relatedTarget as Node | null)) return;
    setFocusWithin(false);
    setManualOpen(false);
  };

  const startEdit = () => {
    setEditText(composeQuery(base, refinements) ?? '');
    setEditNotice(null);
    setEditing(true);
    requestAnimationFrame(() => editRef.current?.focus({ preventScroll: true }));
  };

  const cancelEdit = () => {
    checkToken.current++;
    setChecking(null);
    setEditing(false);
    setEditNotice(null);
    requestAnimationFrame(() => editButtonRef.current?.focus({ preventScroll: true }));
  };

  const applyEdit = (text: string | null) => {
    actions.editIntention(normalizeWords(text));
    setEditing(false);
    setEditNotice(null);
    requestAnimationFrame(() => editButtonRef.current?.focus({ preventScroll: true }));
  };

  const submitEdit = async (e?: React.FormEvent, override?: string) => {
    e?.preventDefault();
    if (blocked || checking) return;
    const text = normalizeWords(override ?? editText);
    if (!text) { applyEdit(null); return; }
    const mine = ++checkToken.current;
    setChecking('edit');
    try {
      const result = assessmentOutcome(await assessIntention({ text }));
      if (mine !== checkToken.current) return;
      if (result.kind === 'proceed') applyEdit(text);
      else setEditNotice(result);
    } catch {
      if (mine === checkToken.current) setEditNotice({ kind: 'blocked', message: UNINTERPRETABLE_MESSAGE, retryable: true });
    } finally {
      if (mine === checkToken.current) setChecking(null);
    }
  };

  const submitRefinement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (blocked || checking) return;
    const text = normalizeWords(refineText);
    if (!text) { setRefineNotice('Type something to add to your Filter.'); return; }
    const mine = ++checkToken.current;
    setChecking('refine');
    setRefineNotice(null);
    try {
      const result = refinementOutcome(await assessIntention({ text }));
      if (mine !== checkToken.current) return;
      if (!result.apply) { setRefineNotice(result.message); return; }
      setRefineTarget(composeQuery(base, [...refinements, text]));
      actions.addRefinement(text);
    } catch {
      if (mine === checkToken.current) setRefineNotice('We couldn’t check that. Your text is still here; select Update results to try again.');
    } finally {
      if (mine === checkToken.current) setChecking(null);
    }
  };

  /**
   * First textual request, typed into the same field. It keeps the former
   * "Add an intention" semantics: assessed like an edit, then set as the
   * base request (no second composer, no new interpretation layer).
   */
  const submitFirst = async (e?: React.FormEvent, override?: string) => {
    e?.preventDefault();
    if (blocked || checking) return;
    const text = normalizeWords(override ?? refineText);
    if (!text) { setRefineNotice('Describe the books you’re looking for.'); return; }
    const mine = ++checkToken.current;
    setChecking('refine');
    setRefineNotice(null);
    setEditNotice(null);
    try {
      const result = assessmentOutcome(await assessIntention({ text }));
      if (mine !== checkToken.current) return;
      if (result.kind === 'proceed') { setRefineTarget(text); actions.editIntention(text); }
      else setEditNotice(result);
    } catch {
      if (mine === checkToken.current) setEditNotice({ kind: 'blocked', message: UNINTERPRETABLE_MESSAGE, retryable: true });
    } finally {
      if (mine === checkToken.current) setChecking(null);
    }
  };

  const meaningful = !!words || !!book || (view?.session.negativeCount ?? 0) > 0;
  const startOver = () => {
    if (meaningful && !confirmStartOver) { setConfirmStartOver(true); return; }
    setConfirmStartOver(false);
    actions.startOver();
  };

  const recipe = {
    baseIntention: base,
    refinements: [...refinements],
    context: ctxMatches ? committed?.sourceModeContext ?? null : null,
    selectedProductIds: book ? [book.id] : [],
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape' || !scrolled) return;
    (document.activeElement as HTMLElement | null)?.blur();
    setFocusWithin(false);
    setManualOpen(false);
  };

  const live = (
    <p className="sr-only" role="status" aria-live="polite" data-testid="status-filter-live">
      {isPending ? pendingText(pending, filter) : saved ? `Saved “${saved}”. You can open it from Home.` : announcement}
    </p>
  );

  const pendingBadge = isPending && (
    <span className="flex items-center gap-1.5 text-role-small text-teal shrink-0" data-testid="status-filter-pending">
      <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      Updating
    </span>
  );

  const intentionText = composeQuery(base, refinements);
  const firstRequest = !intentionText;
  const fieldBusy = checking === 'refine';

  // Assessment notice for an edit or a first request, with its continue action.
  const assessmentNotice = (id: string, onContinue: (label: string, text: string) => void) => editNotice && (
    <div id={id} role="alert" className="mt-2 text-role-small text-foreground" data-testid="text-edit-notice">
      <p className="flex gap-2"><AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-destructive" aria-hidden="true" />{editNotice.message}</p>
      {editNotice.continueLabel && editNotice.continueText && (
        <button type="button" onClick={() => onContinue(editNotice.continueLabel!, editNotice.continueText!)} data-testid="button-edit-continue"
          className="mt-1 min-h-11 px-3 rounded-lg border border-border text-role-ui hover:bg-secondary">
          {editNotice.continueLabel}
        </button>
      )}
    </div>
  );

  const textRequest = editing ? (
    <form onSubmit={submitEdit} aria-labelledby="edit-filter-title" data-testid="form-edit-intention" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); cancelEdit(); } }}>
      <h3 id="edit-filter-title" className="text-role-ui font-semibold text-foreground">Edit Filter</h3>
      <p id="edit-filter-description" className="text-role-small text-muted-foreground mb-2" data-testid="text-edit-filter-description">
        Change what you’re looking for. Books already in your Filter stay unchanged.
      </p>
      <label htmlFor="edit-intention" className="block text-role-ui text-foreground mb-1.5">What are you looking for?</label>
      <input
        ref={editRef}
        id="edit-intention"
        type="text"
        value={editText}
        maxLength={MAX_WORDS_LENGTH}
        onChange={(e) => { setEditText(e.target.value); setEditNotice(null); }}
        aria-describedby={'edit-filter-description' + (editNotice ? ' edit-intention-notice' : '')}
        data-testid="input-edit-intention"
        className="w-full h-12 px-3 text-role-ui rounded-lg border-2 border-border bg-card focus-visible:outline-none focus-visible:border-ring"
      />
      {assessmentNotice('edit-intention-notice', (label, next) => {
        // A narrowed mixed request is assessed again; a mismatch continue is the acknowledgement.
        if (label === 'Continue with books') { setEditText(next); void submitEdit(undefined, next); }
        else applyEdit(next);
      })}
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="submit" disabled={blocked || checking === 'edit'} data-testid="button-update-intention"
          className="min-h-11 px-5 inline-flex items-center gap-2 rounded-lg bg-teal text-teal-foreground text-role-button hover:opacity-90 disabled:opacity-60">
          {checking === 'edit' && <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
          Update results
        </button>
        <button type="button" onClick={cancelEdit} data-testid="button-cancel-edit"
          className="min-h-11 px-4 rounded-lg border border-border text-role-ui text-foreground hover:bg-secondary">
          Cancel
        </button>
      </div>
    </form>
  ) : intentionText ? (
    <div>
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 pt-2 text-role-ui text-foreground break-words" data-testid="text-filter-intention">
          {base && <>“{base}”</>}
          {refinements.map((r, i) => <span key={i + '-' + r} className="text-muted-foreground">{base || i > 0 ? ' + ' : ''}“{r}”</span>)}
        </p>
        <button ref={editButtonRef} type="button" onClick={startEdit} disabled={blocked} data-testid="button-edit-intention"
          className="shrink-0 min-h-11 px-3 inline-flex items-center gap-1.5 rounded-lg border border-border bg-card text-role-ui text-foreground hover:bg-secondary disabled:opacity-50">
          <Pencil className="w-4 h-4" aria-hidden="true" /> Edit Filter
        </button>
      </div>
      {preferences.length > 0 && (
        <p className="text-role-small text-muted-foreground" data-testid="text-filter-preferences">
          Ranked toward: <span className="text-foreground">{preferences.join(' · ')}</span>
        </p>
      )}
      {caveats.length > 0 && (
        <ul className="mt-0.5 text-role-small text-muted-foreground" data-testid="list-filter-caveats">
          {caveats.map((cv) => <li key={cv}>{cv}</li>)}
        </ul>
      )}
    </div>
  ) : null;

  const addForm = !editing && (
    <form onSubmit={firstRequest ? submitFirst : submitRefinement} data-testid="form-add-refinement">
      <label htmlFor="add-refinement" className="block text-role-small text-foreground mb-1">Add to your Filter</label>
      <div className="flex flex-wrap gap-2">
        <input
          ref={refineRef}
          id="add-refinement"
          type="text"
          value={refineText}
          maxLength={firstRequest ? MAX_WORDS_LENGTH : 200}
          onChange={(e) => { setRefineText(e.target.value); setRefineNotice(null); setEditNotice(null); }}
          placeholder={firstRequest ? 'Describe the books you’re looking for' : 'Add another preference, such as graphic novels'}
          aria-describedby={refineNotice ? 'refine-notice' : editNotice ? 'first-request-notice' : undefined}
          enterKeyHint="go"
          data-testid="input-add-refinement"
          className="grow basis-64 min-w-0 h-11 px-3 text-role-ui rounded-lg border-2 border-border bg-card focus-visible:outline-none focus-visible:border-ring placeholder:text-muted-foreground"
        />
        <button type="submit" disabled={blocked || fieldBusy} data-testid="button-apply-refinement"
          className="shrink-0 min-h-11 px-4 inline-flex items-center gap-2 rounded-lg bg-teal text-teal-foreground text-role-button hover:opacity-90 disabled:opacity-60">
          {fieldBusy && <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
          Update results
        </button>
      </div>
      {refineNotice && (
        <p id="refine-notice" role="alert" className="mt-1 text-role-small text-destructive" data-testid="text-refine-notice">{refineNotice}</p>
      )}
      {firstRequest && assessmentNotice('first-request-notice', (label, next) => {
        if (label === 'Continue with books') { setRefineText(next); void submitFirst(undefined, next); }
        else { setEditNotice(null); setRefineTarget(next); actions.editIntention(next); }
      })}
      {suggestions.length > 0 && (
        <div className="mt-2 flex items-center gap-1.5 flex-wrap" role="group" aria-labelledby="refine-suggestions-label">
          <span id="refine-suggestions-label" className="text-role-small text-muted-foreground mr-0.5">Try:</span>
          {suggestions.map((sg) => (
            <button key={sg.id} type="button" disabled={blocked} data-testid={'button-refinement-' + sg.id}
              onClick={() => { setRefineText(sg.text); setRefineNotice(null); refineRef.current?.focus(); }}
              className="min-h-11 px-3 rounded-full border border-border bg-card text-role-small text-foreground hover:border-teal hover:text-teal disabled:opacity-50">
              {sg.label}
            </button>
          ))}
        </div>
      )}
    </form>
  );

  const bookBlock = book && (
    <div data-testid="block-filter-book">
      <p className="text-role-small text-muted-foreground mb-1" id="filter-book-label">Book in your Filter</p>
      <div className="rounded-md border border-teal/30 bg-teal/5 p-2 flex items-center gap-3" role="group" aria-labelledby="filter-book-label">
        {book.coverImageUrl ? (
          <img src={book.coverImageUrl} alt="" className="w-9 h-12 object-contain bg-background rounded-sm shrink-0" />
        ) : (
          <div className="w-9 h-12 bg-background border border-border rounded-sm flex items-center justify-center shrink-0">
            <BookOpen className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
          </div>
        )}
        <p className="min-w-0 flex-1 text-role-metadata text-foreground font-semibold break-words" title={book.title} data-testid="text-filter-book-title">{book.title}</p>
        <button type="button" onClick={() => controller.removeBook()} data-testid="button-remove-book" disabled={blocked}
          aria-label={'Remove ' + book.title + ' from Filter'}
          className="min-h-11 px-2 inline-flex items-center gap-1 rounded-md text-role-small text-foreground hover:bg-secondary disabled:opacity-50 disabled:cursor-not-allowed shrink-0">
          <X className="w-4 h-4" aria-hidden="true" />
          <span className="min-[420px]:hidden">Remove</span>
          <span className="hidden min-[420px]:inline">Remove from Filter</span>
        </button>
      </div>
    </div>
  );

  return (
    <>
      <div ref={sentinelRef} aria-hidden="true" />
      <div aria-hidden="true" style={{ height: spacer }} />
      <section
        ref={ribbonRef}
        id="your-filter"
        tabIndex={-1}
        aria-labelledby="your-filter-heading"
        aria-busy={isPending}
        data-testid="ribbon-your-filter"
        data-state={compact ? 'compact' : 'expanded'}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        className={'sticky top-[var(--top-navigation-height,0px)] z-40 -mx-4 md:-mx-8 px-4 md:px-8 bg-background/95 backdrop-blur-sm border-b border-border focus-visible:outline-2 ' + (compact ? 'py-2 shadow-sm' : 'py-3 md:py-4') + (!compact && scrolled ? ' shadow-sm' : '')}
      >
        {live}
        {compact ? (
          <div className="flex items-center gap-2 md:gap-3 min-h-11" data-testid="ribbon-compact">
            <h2 id="your-filter-heading" className="sr-only min-[520px]:not-sr-only text-role-ui font-sans text-muted-foreground shrink-0">Your Filter</h2>
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {!words && !book && (
                <span className="text-role-small text-muted-foreground truncate" data-testid="text-compact-empty">All books</span>
              )}
              {words && (
                <span title={words} className="min-w-0 truncate text-role-ui text-foreground bg-card border border-border rounded-md px-2 py-1" data-testid="text-compact-words">
                  “{words}”
                </span>
              )}
              {book && (
                <span title={book.title} className="min-w-0 max-w-[45%] flex items-center gap-1.5 bg-teal/5 border border-teal/20 rounded-md pl-1 pr-2 py-0.5" data-testid="text-compact-book">
                  {book.coverImageUrl
                    ? <img src={book.coverImageUrl} alt="" className="w-5 h-7 object-contain rounded-sm shrink-0" />
                    : <BookOpen className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />}
                  <span className="truncate text-role-small text-foreground"><span className="sr-only">In your Filter: </span>{book.title}</span>
                </span>
              )}
              {error && (
                <span className="flex items-center gap-1 text-role-small text-destructive shrink-0" data-testid="text-compact-error">
                  <AlertCircle className="w-4 h-4" aria-hidden="true" /> <span className="hidden sm:inline">Not applied</span>
                </span>
              )}
            </div>
            {pendingBadge}
            {error && (
              <button type="button" onClick={() => controller.retry()} data-testid="button-compact-retry"
                className="min-h-11 px-3 inline-flex items-center gap-1.5 rounded-lg border border-border text-role-ui text-foreground hover:bg-secondary shrink-0">
                <RotateCw className="w-4 h-4" aria-hidden="true" /> Retry
              </button>
            )}
            <button type="button" onClick={openEditor} data-testid="button-edit-filter" aria-label="Edit Filter"
              className="min-h-11 px-4 inline-flex items-center gap-1.5 rounded-lg bg-teal text-teal-foreground text-role-button hover:opacity-90 shrink-0">
              <Pencil className="w-4 h-4" aria-hidden="true" /> Edit
            </button>
          </div>
        ) : (
          <div data-testid="ribbon-expanded">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 id="your-filter-heading" className="text-role-ui font-semibold font-sans text-foreground">Your Filter</h2>
              <SaveModeDialog
                  open={dialogOpen}
                  onOpenChange={setDialogOpen}
                  triggerLabel={sourceModeName ? 'Save as a new Mode' : 'Save as a Mode'}
                  suggestedName={suggestModeName({ base, refinements, bookTitle: book?.title ?? null, sourceModeName })}
                  recipe={recipe}
                  hasExampleBook={!!book}
                  onSaved={setSaved}
                  disabled={isPending || blocked || !view}
                />
                <div className="ml-auto flex items-center gap-2">
                  {pendingBadge}
                  {scrolled && !forceExpanded && !editing && (
                    <button type="button" onClick={() => { (document.activeElement as HTMLElement | null)?.blur(); setFocusWithin(false); setManualOpen(false); }}
                      data-testid="button-collapse-filter"
                      className="min-h-11 px-3 rounded-lg border border-border text-role-ui text-foreground hover:bg-secondary">
                      Done
                    </button>
                  )}
                </div>
            </div>
            {sourceModeName && (
              <p className="text-role-small text-muted-foreground" data-testid="text-filter-source-mode">
                Started from <strong className="font-semibold text-foreground">{sourceModeName}</strong>
              </p>
            )}

            {error && (
              <div role="alert" className="mt-2 rounded-md border border-destructive/40 bg-destructive/5 p-3" data-testid="alert-filter-error">
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

            {notice && (
              <p className="mt-1 flex flex-wrap items-center gap-x-2 text-role-small text-foreground" role="status" data-testid="text-context-notice">
                {notice}
                <button type="button" onClick={() => store?.dismissNotice()} className="min-h-11 px-1 underline underline-offset-2">Dismiss</button>
              </p>
            )}

            {/* Reading order: text request, book in Filter, then the add field. On
                wide screens the book sits in a second column beside both. */}
            <div className={'mt-2 grid gap-3 ' + (book ? 'lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)] lg:gap-x-8' : 'max-w-[760px]')}>
              {textRequest && <div className="min-w-0 lg:col-start-1">{textRequest}</div>}
              {bookBlock && <div className="min-w-0 lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:self-start">{bookBlock}</div>}
              {addForm && <div className="min-w-0 lg:col-start-1">{addForm}</div>}
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-x-3" data-testid="row-filter-actions">
              <p id="clear-filter-description" className="sr-only">Clears this Filter. Saved Modes and your Cart stay unchanged.</p>
              {confirmStartOver ? (
                <span className="flex flex-wrap items-center gap-x-2 text-role-small text-foreground" data-testid="text-start-over-confirm">
                  Clear this Filter? Saved Modes and your Cart stay unchanged.
                  <button type="button" onClick={startOver} data-testid="button-start-over-confirm" className="min-h-11 px-1 underline underline-offset-2 font-semibold">Clear Filter</button>
                  <button type="button" onClick={() => setConfirmStartOver(false)} className="min-h-11 px-1 underline underline-offset-2">Keep</button>
                </span>
              ) : (
                <button type="button" onClick={startOver} disabled={blocked} data-testid="button-start-over" aria-describedby="clear-filter-description"
                  className="min-h-11 px-0.5 text-role-small text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50">
                  Clear Filter
                </button>
              )}
              {saved && (
                <p className="text-role-small text-teal font-medium" data-testid="text-save-success">
                  Saved “{saved}”. You can open it from Home.
                </p>
              )}
            </div>
          </div>
        )}
      </section>
    </>
  );
}
