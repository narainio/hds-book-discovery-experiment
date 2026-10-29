import { useEffect, useLayoutEffect, useRef } from 'react';
import { RotateCw } from 'lucide-react';
import { useGetCatalogStats } from '@workspace/api-client-react';
import { useYourFilter, focusYourFilter } from '@/hooks/use-your-filter';
import { useWorkingContext } from '@/hooks/use-working-context';
import { YourFilter } from '@/components/your-filter';
import { BookCard } from '@/components/book-card';
import { resultsHeading } from '@/lib/filter-controller';
import { catalogScope, resultsCountText } from '@/lib/results-copy';

const GRID = 'grid grid-cols-1 min-[420px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-x-3 gap-y-8 md:gap-x-5 md:gap-y-10';

export default function Discover() {
  const { view, status, pending, error, more, controller } = useYourFilter();
  const { store, committed } = useWorkingContext();
  const { data: stats } = useGetCatalogStats();
  const restored = useRef(false);

  useEffect(() => {
    if (window.location.hash === '#your-filter') focusYourFilter();
  }, []);

  useEffect(() => { store?.markStarted(); }, [store, committed]);

  // Restore the browsing position for PDP Back, browser Back and Continue
  // discovering. A newly started context records position 0.
  useLayoutEffect(() => {
    if (restored.current || !view || !store) return;
    restored.current = true;
    const snapshot = store.getSnapshot();
    const y = snapshot.proposal?.replace ? 0 : snapshot.committed?.scrollY ?? 0;
    window.scrollTo(0, y);
  }, [view, store]);

  useEffect(() => {
    if (!store) return;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (restored.current) store.rememberScroll(window.scrollY);
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
      store.persist();
    };
  }, [store]);

  const discover = view?.discover ?? null;
  const filter = view?.filter ?? null;
  const isPending = !!pending;
  // A new context (Home intention, Browse all, Open Mode, Start over) shows
  // reserved skeletons instead of the previous context's results.
  const finding = !!pending?.clearNegatives;
  const scope = catalogScope(stats?.gradeLabel);

  return (
    <div className="flex flex-col w-full">
      <h1 tabIndex={-1} className="sr-only">Discover books</h1>
      <div className="px-4 md:px-8 max-w-[1440px] mx-auto w-full">
        <YourFilter />
        <section className="pt-4 md:pt-6" aria-labelledby="results-heading" aria-busy={isPending || status === 'loading'}>
          <div className="mb-4">
            <h2 id="results-heading" className="text-role-subsection-title text-foreground mb-1" data-testid="text-results-heading">
              {finding ? 'Finding books…' : resultsHeading(filter)}
            </h2>
            {!finding && discover && discover.results.length > 0 && (
              <p className="text-role-metadata text-muted-foreground" data-testid="text-results-count">
                {resultsCountText(discover.results.length, discover.totalAvailable)}
                {scope && <span data-testid="text-catalog-scope"> · {scope}</span>}
              </p>
            )}
            {!finding && discover && discover.results.length > 0 && !filter?.book && (
              <p className="text-role-small text-muted-foreground mt-1" data-testid="text-add-book-hint">
                Add a book to your Filter to shape what you see next.
              </p>
            )}
            {!finding && discover?.relaxed && discover.relaxedNote && (
              <p className="text-role-metadata text-muted-foreground mt-1">{discover.relaxedNote}</p>
            )}
          </div>

          {status === 'load-error' && !discover ? (
            <div className="text-center py-16 border-2 border-dashed border-border rounded-xl" role="alert">
              <h3 className="text-role-subsection-title text-foreground mb-2">Results could not be loaded</h3>
              <p className="text-muted-foreground mb-4">{error?.message}</p>
              <button type="button" onClick={() => controller.retry()} data-testid="button-results-retry"
                className="min-h-11 px-5 inline-flex items-center gap-2 rounded-lg bg-teal text-teal-foreground text-role-button">
                <RotateCw className="w-4 h-4" aria-hidden="true" /> Retry
              </button>
            </div>
          ) : !discover || finding ? (
            <div className={GRID} data-testid="grid-skeleton">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="flex flex-col animate-pulse">
                  <div className="aspect-[2/3] bg-muted rounded-md mb-3" />
                  <div className="h-4 bg-muted rounded w-3/4 mb-2" />
                  <div className="h-3 bg-muted rounded w-1/2 mb-4" />
                  <div className="h-11 bg-muted rounded-lg" />
                </div>
              ))}
            </div>
          ) : discover.results.length === 0 ? (
            <div className="text-center py-20 border-2 border-dashed border-border rounded-xl">
              <h3 className="text-role-subsection-title text-foreground mb-2">We couldn’t find an exact match</h3>
              <p className="text-muted-foreground">Try editing your Filter or removing the book from it.</p>
            </div>
          ) : (
            <div className={`${GRID} transition-opacity duration-200 ${isPending ? 'opacity-60' : 'opacity-100'}`} data-testid="grid-results">
              {discover.results.map((ranked) => (
                <BookCard key={ranked.book.id} book={ranked.book} score={ranked.score} reason={ranked.reason} />
              ))}
            </div>
          )}

          {!finding && discover?.hasMore && discover.results.length > 0 && (
            <div className="mt-12 flex flex-col items-center gap-3">
              {more === 'error' && (
                <p role="alert" className="text-role-small text-foreground" data-testid="text-more-error">
                  More books could not be loaded. The books above are unchanged.
                </p>
              )}
              <button
                type="button"
                onClick={() => void controller.loadMore()}
                disabled={more === 'loading' || isPending}
                data-testid="button-show-more"
                className="min-h-11 px-8 py-3 bg-secondary text-foreground hover:bg-border font-medium rounded-full transition-colors border border-border shadow-sm disabled:opacity-60 disabled:cursor-wait"
              >
                {more === 'loading' ? 'Loading more books...' : more === 'error' ? 'Try again' : 'Show more books'}
              </button>
            </div>
          )}
          <p className="sr-only" role="status" aria-live="polite">
            {more === 'loading' ? 'Loading more books' : ''}
          </p>
        </section>
      </div>
    </div>
  );
}
