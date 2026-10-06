import { useEffect } from 'react';
import { RotateCw } from 'lucide-react';
import { useListPrompts, useGetCatalogStats } from '@workspace/api-client-react';
import { useSession } from '@/hooks/use-session';
import { useYourFilter, focusYourFilter } from '@/hooks/use-your-filter';
import { YourFilter } from '@/components/your-filter';
import { BookCard } from '@/components/book-card';
import { filterKind, resultsHeading } from '@/lib/filter-controller';

const GRID = 'grid grid-cols-1 min-[420px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-x-3 gap-y-8 md:gap-x-5 md:gap-y-10';

export default function Discover() {
  const { session } = useSession();
  const { view, status, pending, error, more, controller } = useYourFilter();
  const { data: prompts } = useListPrompts();
  const { data: stats } = useGetCatalogStats();

  useEffect(() => {
    if (window.location.hash === '#your-filter') focusYourFilter();
  }, []);

  const discover = view?.discover ?? null;
  const filter = view?.filter ?? null;
  const isPending = !!pending;
  const blocked = error?.kind === 'unsynced';

  return (
    <div className="flex flex-col w-full">
      <section className="px-4 md:px-8 pt-8 pb-6 bg-secondary/10 border-b border-border">
        <div className="max-w-[1440px] mx-auto w-full">
          <h1 className="text-role-display text-foreground mb-3">Find a book Johnny will enjoy</h1>
          <p className="text-role-body-large text-muted-foreground max-w-2xl">
            Start with words or a book, or browse books selected for{' '}
            {(session?.gradeLabel ?? 'age 10 \u00b7 grades 4\u20135').replace(' \u00b7 ', ' and ')}.
          </p>
          {prompts && prompts.length > 0 && (
            <div className="mt-4 flex gap-2 overflow-x-auto pb-2 scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0" aria-label="Suggested directions">
              {prompts.map((prompt) => (
                <button
                  key={prompt.id}
                  type="button"
                  disabled={blocked}
                  onClick={() => controller.setWords(prompt.query, prompt.id)}
                  data-testid={`button-prompt-${prompt.id}`}
                  className="shrink-0 min-h-11 px-4 py-2 bg-card border border-border hover:border-teal hover:text-teal rounded-full text-role-ui text-muted-foreground transition-colors whitespace-nowrap shadow-sm disabled:opacity-50"
                >
                  {prompt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      <div className="px-4 md:px-8 py-8 md:py-10 max-w-[1440px] mx-auto w-full lg:grid lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-8">
        <aside className="mb-8 sticky top-[var(--top-navigation-height,100px)] z-40 bg-background lg:static lg:z-auto lg:mb-0">
          <div className="max-h-[calc(65dvh-var(--top-navigation-height,100px))] overflow-y-auto overscroll-contain lg:max-h-none lg:overflow-visible lg:sticky lg:top-[96px]">
            <YourFilter />
          </div>
        </aside>

        <section aria-labelledby="results-heading" aria-busy={isPending || status === 'loading'}>
          <div className="mb-4">
            <h2 id="results-heading" className="text-role-section-title text-foreground mb-1" data-testid="text-results-heading">
              {resultsHeading(filter)}
            </h2>
            {discover?.subheading && <p className="text-role-metadata text-muted-foreground">{discover.subheading}</p>}
            {filterKind(filter) === 'empty' && stats && !discover?.subheading && (
              <p className="text-role-metadata text-muted-foreground">About {stats.totalBooks.toLocaleString()} books for this mode</p>
            )}
            {discover?.relaxed && discover.relaxedNote && (
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
          ) : !discover ? (
            <div className={GRID}>
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
              <p className="text-muted-foreground">Try changing your direction or removing the book in Your Filter.</p>
            </div>
          ) : (
            <div className={`${GRID} transition-opacity duration-200 ${isPending ? 'opacity-60' : 'opacity-100'}`} data-testid="grid-results">
              {discover.results.map((ranked) => (
                <BookCard key={ranked.book.id} book={ranked.book} score={ranked.score} reason={ranked.reason} />
              ))}
            </div>
          )}

          {discover?.hasMore && discover.results.length > 0 && (
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
