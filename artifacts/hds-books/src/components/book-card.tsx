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
  const isExample = view?.filter.book?.id === book.id;
  const isPendingExample = !isExample && pending?.book?.id === book.id;

  const handleUseExample = (e: React.MouseEvent) => {
    e.preventDefault(); // Prevent navigating to PDP
    e.stopPropagation();
    // Selecting the active example again is idempotent: no add, no removal.
    if (isExample || blocked) return;
    controller.setBook({ id: book.id, title: book.title, coverImageUrl: book.coverImageUrl ?? null });
  };

  return (
    <Link href={`/book/${book.id}`} data-testid={`card-book-${book.id}`} className={`group flex flex-col h-full hover:opacity-95 transition-opacity rounded-lg ${isExample ? 'ring-2 ring-teal/50 ring-offset-4 ring-offset-background' : ''}`}>
      {/* Cover Area */}
      <div className="relative aspect-[2/3] w-full max-w-[200px] min-[420px]:max-w-none mx-auto bg-secondary/50 rounded-md overflow-hidden flex items-center justify-center mb-3">
        {book.hasCover && book.coverImageUrl ? (
          <img
            src={book.coverImageUrl}
            alt={`Cover of ${book.title}`}
            className="w-full h-full object-contain mix-blend-multiply"
            loading="lazy"
          />
        ) : (
          <div className="p-4 text-center">
            <span className="text-role-small text-muted-foreground font-medium block mb-1">{book.title}</span>
            <span className="text-role-small text-muted-foreground block">{book.author}</span>
          </div>
        )}
      </div>

      {/* Recommendation Reason */}
      {reason && (
        <div className="mb-2">
          <span className="text-[14px] md:text-[15px] font-medium text-teal px-2 py-0.5 bg-teal-soft rounded-sm leading-tight inline-block border border-teal/10">
            {reason.text}
          </span>
        </div>
      )}

      {/* Title & Author */}
      <h3 className="text-role-card-title text-foreground line-clamp-2 md:line-clamp-2 mb-1 group-hover:underline decoration-1 underline-offset-2">
        {book.title}
      </h3>
      <p className="text-role-metadata text-muted-foreground mb-2 line-clamp-1">
        {book.author}
      </p>

      <div className="mt-auto flex flex-col pt-2 gap-2">
        <div className="flex flex-col">
          <PriceDisplay
            price={book.price}
            catalogPrice={book.catalogPrice}
            currency={book.currency}
          />
          <span className="text-role-metadata text-muted-foreground mt-1">{book.formatLabel}</span>
        </div>
        
        <button
          type="button"
          onClick={handleUseExample}
          aria-pressed={isExample}
          aria-disabled={blocked || undefined}
          aria-describedby={isExample ? `example-note-${book.id}` : undefined}
          data-testid={`button-use-example-${book.id}`}
          className={`flex shrink-0 w-full items-center justify-center rounded-lg border py-2.5 px-4 transition-colors min-h-[44px] ${
            isExample
              ? 'bg-teal/10 border-teal/40 text-teal cursor-default'
              : 'bg-card border-border text-foreground hover:border-teal hover:text-teal'
          } ${isPendingExample ? 'opacity-70 cursor-wait' : ''}`}
        >
          {isExample
            ? <Check className="w-[20px] h-[20px] shrink-0" strokeWidth={2} aria-hidden="true" />
            : <Sparkles className="w-[20px] h-[20px] shrink-0" strokeWidth={1.75} aria-hidden="true" />}
          <span className="ml-2 text-role-button">
            {isExample ? 'In Filter' : isPendingExample ? 'Adding...' : 'Use to shape results'}
          </span>
        </button>
        {isExample && (
          <span id={`example-note-${book.id}`} className="text-role-small text-muted-foreground text-center">
            Your example · not a required match
          </span>
        )}
      </div>
    </Link>
  );
}
