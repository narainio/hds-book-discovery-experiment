import React from 'react';
import { Link } from 'wouter';
import { Check, Sparkles } from 'lucide-react';
import type { RankedBook, BookSummary } from '@workspace/api-client-react';
import { useYourFilter } from '@/hooks/use-your-filter';
import { PriceDisplay } from '@/components/price-display';

interface BookCardProps {
  book: BookSummary;
  score?: number;
  reason?: RankedBook['reason'];
}

export function BookCard({ book, reason }: BookCardProps) {
  const { view, pending, error, controller } = useYourFilter();
  const blocked = error?.kind === 'unsynced';
  const activeExample = view?.filter.book ?? null;
  const isExample = activeExample?.id === book.id;
  const isPendingExample = !isExample && pending?.book?.id === book.id;
  // The Filter holds one book; choosing another replaces it, so that case says "Use instead".
  const label = isExample ? 'In Filter' : isPendingExample ? 'Adding...' : activeExample ? 'Use instead' : 'Add to Filter';
  const accessibleLabel = isExample
    ? `${book.title} is in your Filter`
    : activeExample && !isPendingExample
      ? `Use ${book.title} instead of ${activeExample.title} in your Filter`
      : `${label}: ${book.title}`;

  const handleUseExample = (e: React.MouseEvent) => {
    e.preventDefault();
    // Selecting the active example again is idempotent: no add, no removal.
    if (isExample || blocked) return;
    controller.setBook({ id: book.id, title: book.title, coverImageUrl: book.coverImageUrl ?? null });
  };

  return (
    <article data-testid={`card-book-${book.id}`} className={`group flex flex-col h-full rounded-lg ${isExample ? 'ring-2 ring-teal/50 ring-offset-4 ring-offset-background' : ''}`}>
      <Link href={`/book/${book.id}`} tabIndex={-1} aria-hidden="true" className="block hover:opacity-95 transition-opacity">
        <div className="relative aspect-[2/3] w-full max-w-[200px] min-[420px]:max-w-none mx-auto bg-secondary/50 rounded-md overflow-hidden flex items-center justify-center mb-3">
          {book.hasCover && book.coverImageUrl ? (
            <img src={book.coverImageUrl} alt="" className="w-full h-full object-contain mix-blend-multiply" loading="lazy" />
          ) : (
            <div className="p-4 text-center">
              <span className="text-role-small text-muted-foreground font-medium block mb-1">{book.title}</span>
              <span className="text-role-small text-muted-foreground block">{book.author}</span>
            </div>
          )}
        </div>
      </Link>

      {(isExample || reason) && (
        <div className="mb-2">
          <span className="text-[14px] md:text-[15px] font-medium text-teal px-2 py-0.5 bg-teal-soft rounded-sm leading-tight inline-block border border-teal/10" data-testid={`text-reason-${book.id}`}>
            {isExample ? 'In your Filter' : reason?.text}
          </span>
        </div>
      )}

      <h3 className="text-role-card-title text-foreground line-clamp-2 mb-1">
        <Link href={`/book/${book.id}`} data-testid={`link-book-${book.id}`} className="hover:underline decoration-1 underline-offset-2">
          {book.title}
        </Link>
      </h3>
      <p className="text-role-metadata text-muted-foreground mb-2 line-clamp-1">{book.author}</p>

      <button
        type="button"
        onClick={handleUseExample}
        aria-pressed={isExample}
        aria-disabled={blocked || undefined}
        aria-label={accessibleLabel}
        data-testid={`button-use-example-${book.id}`}
        className={`self-start inline-flex items-center gap-1.5 rounded-lg border px-3 min-h-11 text-role-ui transition-colors ${
          isExample
            ? 'bg-teal/10 border-teal/40 text-teal cursor-default'
            : 'bg-card border-border text-foreground hover:border-teal hover:text-teal'
        } ${isPendingExample ? 'opacity-70 cursor-wait' : ''} ${blocked && !isExample ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        {isExample
          ? <Check className="w-[18px] h-[18px] shrink-0" strokeWidth={2} aria-hidden="true" />
          : <Sparkles className="w-[18px] h-[18px] shrink-0" strokeWidth={1.75} aria-hidden="true" />}
        <span>{label}</span>
      </button>

      <div className="mt-auto flex flex-col pt-3">
        <PriceDisplay price={book.price} catalogPrice={book.catalogPrice} currency={book.currency} />
        <span className="text-role-metadata text-muted-foreground mt-1">{book.formatLabel}</span>
      </div>
    </article>
  );
}
