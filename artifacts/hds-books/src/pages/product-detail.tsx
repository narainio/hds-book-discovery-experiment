import React, { useEffect, useState, useRef } from 'react';
import { useRoute, useLocation, Link } from 'wouter';
import { ArrowLeft, Check, Sparkles, Plus, Share, CheckCircle2, ChevronDown } from 'lucide-react';
import { useSession } from '@/hooks/use-session';
import { 
  useGetBook, 
  useAddNegative,
  useAddCartItem,
  useRecordEvent,
  getGetBookQueryKey
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  setCartState,
  setSessionState,
} from '@/lib/discovery-cache';
import { PriceDisplay } from '@/components/price-display';
import { useYourFilter } from '@/hooks/use-your-filter';

export default function ProductDetail() {
  const [match, params] = useRoute('/book/:id');
  const [, setLoc] = useLocation();
  const { session, sessionId } = useSession();
  const queryClient = useQueryClient();
  
  const bookId = params?.id || '';
  
  const { data: book, isLoading, error } = useGetBook(bookId, {
    query: {
      enabled: !!bookId,
      queryKey: getGetBookQueryKey(bookId),
      staleTime: 60_000,
      refetchOnMount: "always",
    }
  });

  const { view: filterView, pending: filterPending, error: filterError, controller: filterController } = useYourFilter();
  const addNegative = useAddNegative();
  const addCartItem = useAddCartItem();
  const recordEvent = useRecordEvent();

  const isExample = filterView?.filter.book?.id === bookId;
  const isPendingExample = !isExample && filterPending?.book?.id === bookId;
  const filterBlocked = filterError?.kind === 'unsynced';
  const inCart = session?.cartIds?.includes(bookId) || false;

  const [notice, setNotice] = useState<string | null>(null);
  
  const viewedRef = useRef<string | null>(null);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [bookId]);

  useEffect(() => {
    if (sessionId && bookId && viewedRef.current !== bookId) {
      viewedRef.current = bookId;
      recordEvent.mutate({
        data: {
          sessionId,
          name: 'pdp_viewed',
          bookId
        }
      });
    }
  }, [sessionId, bookId]);

  if (isLoading) {
    return (
      <div className="p-8 flex flex-col md:flex-row space-y-4 md:space-y-0 md:space-x-12 max-w-6xl mx-auto animate-pulse">
        <div className="w-full md:w-[42%] aspect-[2/3] bg-muted rounded-md shrink-0 max-w-[420px]"></div>
        <div className="w-full md:w-[58%] space-y-6">
          <div className="h-8 bg-muted rounded w-3/4"></div>
          <div className="h-4 bg-muted rounded w-1/2"></div>
          <div className="h-10 bg-muted rounded w-1/3 mt-8"></div>
          <div className="space-y-2 mt-8">
            <div className="h-4 bg-muted rounded w-full"></div>
            <div className="h-4 bg-muted rounded w-full"></div>
            <div className="h-4 bg-muted rounded w-5/6"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !book) {
    return (
      <div className="p-8 text-center mt-20">
        <h2 className="text-2xl font-serif font-semibold text-foreground mb-4">Book not found</h2>
        <Link href="/" className="text-teal hover:underline font-medium">Return to discovery</Link>
      </div>
    );
  }

  const handleUseExample = () => {
    if (!book || isExample || filterBlocked) return;
    filterController.setBook({ id: book.id, title: book.title, coverImageUrl: book.coverImageUrl ?? null });
    setLoc('/');
  };

  const handleFewerLikeThis = () => {
    if (!sessionId) return;
    addNegative.mutate({ sessionId, data: { bookId } }, {
      onSuccess: (nextSession) => {
        setSessionState(queryClient, sessionId, nextSession);
        // Re-read committed results through the serialized Filter controller.
        filterController.refresh();
        setLoc('/');
      }
    });
  };

  const handleAddToCart = () => {
    if (!sessionId) return;
    addCartItem.mutate({ sessionId, data: { bookId, quantity: 1 } }, {
      onSuccess: (cart) => {
        setCartState(queryClient, sessionId, cart);
        setNotice('Added to cart');
        setTimeout(() => setNotice(null), 3000);
      }
    });
  };

  return (
    <div className="w-full bg-background relative pb-24 md:pb-12">
      {notice && (
        <div className="fixed top-[56px] md:top-[72px] left-0 right-0 z-40 bg-coral text-coral-foreground px-4 py-2 text-sm font-medium text-center shadow-md animate-in fade-in slide-in-from-top-4">
          {notice}
        </div>
      )}

      {/* Mobile Sticky Top Bar */}
      <div className="md:hidden sticky top-[56px] z-30 bg-card border-b border-border flex items-center justify-between px-4 h-14">
        <Link href="/" className="flex items-center gap-2 text-foreground font-medium hover:text-teal">
          <ArrowLeft className="w-5 h-5" /> Back
        </Link>
        <button
          className="p-2 text-muted-foreground hover:text-foreground"
          aria-label="Share this book"
          title="Share this book"
        >
          <Share className="w-5 h-5" />
        </button>
      </div>

      <div className="max-w-[1280px] mx-auto w-full flex flex-col md:flex-row md:items-start p-4 md:p-8 lg:p-12 gap-8 lg:gap-16">
        
        {/* Left Column: Cover */}
        <div className="w-full md:w-[42%] md:sticky md:top-[104px] flex flex-col items-center">
          <div className="w-full max-w-[420px] aspect-[2/3] bg-secondary/50 rounded-lg overflow-hidden border border-border shadow-sm flex items-center justify-center">
            {book.hasCover && book.coverImageUrl ? (
              <img
                src={book.coverImageUrl}
                alt={`Cover of ${book.title}`}
                className="w-full h-full object-contain mix-blend-multiply"
              />
            ) : (
              <div className="p-8 text-center">
                <span className="text-sm text-muted-foreground font-medium block mb-2">{book.title}</span>
                <span className="text-role-small text-muted-foreground block">{book.author}</span>
              </div>
            )}
          </div>
          
          <div className="hidden md:flex w-full max-w-[420px] mt-6 justify-between items-center text-sm font-medium">
            <Link href="/" className="flex items-center gap-2 text-muted-foreground hover:text-foreground">
              <ArrowLeft className="w-4 h-4" /> Back to discovery
            </Link>
            <button
              className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
              aria-label="Share this book"
            >
              <Share className="w-4 h-4" /> Share
            </button>
          </div>
        </div>

        {/* Right Column: Info */}
        <div className="w-full md:w-[58%] flex flex-col">
          {book.seriesName && (
            <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              {book.seriesName}
            </p>
          )}
          
          <h1 className="text-role-page-title mb-2">
            {book.title}
          </h1>
          
          <p className="text-role-body-large text-muted-foreground mb-6">
            By {book.author} {book.illustrator && <span>· Illustrated by {book.illustrator}</span>}
          </p>
          
          {/* Price & Format */}
          <div className="flex flex-col mb-8">
            <div className="flex items-end gap-4">
              <PriceDisplay
                price={book.price}
                catalogPrice={book.catalogPrice}
                currency={book.currency}
                size="large"
              />
              <span className="text-base text-muted-foreground">{book.formatLabel}</span>
            </div>
            {book.availabilityLabel && (
              <span className="text-sm font-medium text-success mt-1">{book.availabilityLabel}</span>
            )}
          </div>

          {/* Desktop Commerce Action */}
          <div className="hidden md:flex mb-8">
            <button
              onClick={handleAddToCart}
              disabled={book.price === null || addCartItem.isPending}
              className={`flex-1 max-w-sm flex items-center justify-center gap-2 py-4 px-8 rounded-lg text-lg font-bold transition-all shadow-sm ${
                book.price === null 
                  ? 'bg-muted text-muted-foreground cursor-not-allowed'
                  : 'bg-coral text-coral-foreground hover:bg-coral-hover hover:shadow-md'
              }`}
            >
              {inCart ? <CheckCircle2 className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
              {inCart ? 'Add another to cart' : 'Add to cart'}
            </button>
          </div>

          {/* Facts Grid */}
          <div className="bg-card border border-border rounded-xl p-5 mb-8">
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-y-4 gap-x-6 text-role-metadata">
              <div className="flex flex-col">
                <dt className="text-muted-foreground font-medium mb-1">Reading level</dt>
                <dd className="text-foreground">{book.readingLevel}</dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-muted-foreground font-medium mb-1">Format</dt>
                <dd className="text-foreground">{book.formatLabel}</dd>
              </div>
              {book.seriesName && (
                <div className="flex flex-col sm:col-span-2">
                  <dt className="text-muted-foreground font-medium mb-1">Series</dt>
                  <dd className="text-foreground">{book.seriesName}</dd>
                </div>
              )}
              {book.publisher && (
                <div className="flex flex-col">
                  <dt className="text-muted-foreground font-medium mb-1">Publisher</dt>
                  <dd className="text-foreground">{book.publisher}</dd>
                </div>
              )}
            </dl>
          </div>

          {/* Discovery Actions */}
          <div className="flex flex-col gap-3 mb-10 pb-10 border-b border-border">
            <button
              type="button"
              onClick={handleUseExample}
              aria-pressed={isExample}
              aria-disabled={filterBlocked || undefined}
              data-testid="button-use-example"
              className={`w-full py-3.5 px-6 rounded-lg text-base font-semibold flex items-center justify-center gap-2 border transition-all ${
                isExample
                  ? 'bg-teal/10 border-teal/40 text-teal cursor-default'
                  : 'bg-card border-border text-foreground hover:border-teal hover:text-teal'
              }`}
            >
              {isExample ? <Check className="w-5 h-5" aria-hidden="true" /> : <Sparkles className="w-5 h-5" aria-hidden="true" />}
              {isExample ? 'In Filter' : isPendingExample ? 'Adding...' : 'Use to shape results'}
            </button>
            <p className="text-role-small text-muted-foreground">
              {isExample ? 'Your example · not a required match. Remove it from Your Filter at any time.' : 'Uses this book as an example. It is not saved or added to your cart, and replaces any previous example.'}
            </p>

            <div className="flex items-center justify-end gap-2 mt-2">
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button className="py-3 px-4 rounded-lg bg-card border border-border text-muted-foreground hover:bg-secondary transition-colors" aria-label="More discovery options">
                    <ChevronDown className="w-4 h-4" />
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content align="end" className="bg-card border border-border rounded-lg shadow-lg p-1 min-w-[200px] z-50">
                    <DropdownMenu.Item
                      onClick={handleFewerLikeThis}
                      className="px-3 py-2 text-sm text-foreground hover:bg-secondary rounded-md cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                    >
                      Show me fewer like this
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </div>
          </div>

          {/* Why it may suit Johnny */}
          {book.whyItMaySuit && (
            <div className="mb-10">
              <h2 className="text-role-section-title text-foreground mb-4">Why it may suit Johnny</h2>
              <div className="text-role-body-large text-foreground leading-relaxed">
                <p>{book.whyItMaySuit}</p>
                <p className="text-role-small text-muted-foreground mt-3">Based on the book's catalog information.</p>
              </div>
            </div>
          )}

          {/* Catalog-grounded subject presentation */}
          {(book.subjectSummary || book.displayTopics.length > 0) && (
            <section className="mb-10 max-w-[65ch]" aria-label="Book topics">
              {book.subjectSummary && (
                <div className={book.displayTopics.length > 0 ? "mb-6" : undefined}>
                  <h2 className="text-role-section-title text-foreground mb-4">What it explores</h2>
                  <p className="text-role-body-large text-foreground leading-relaxed" data-testid="text-subject-summary">
                    {book.subjectSummary}
                  </p>
                  <p className="text-role-small font-sans not-italic text-muted-foreground mt-3" data-testid="text-subject-summary-provenance">
                    HDS summary based on the book’s catalog information.
                  </p>
                </div>
              )}
              {book.displayTopics.length > 0 && (
                <div>
                  <h2 className="text-role-section-title text-foreground mb-4">Topics</h2>
                  <p className="text-role-body-large text-foreground leading-relaxed" data-testid="text-display-topics">
                    {book.displayTopics.join(", ")}
                  </p>
                </div>
              )}
            </section>
          )}

          {/* Description */}
          <div className="mb-12">
            <h2 className="text-role-section-title text-foreground mb-4">About this book</h2>
            <div 
              className="text-role-body-large max-w-[65ch] text-foreground leading-relaxed [&_p]:mb-4"
              dangerouslySetInnerHTML={{ __html: book.description }}
            />
          </div>
          
        </div>
      </div>

      {/* Mobile Sticky Commerce Bar */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 p-4 bg-card border-t border-border shadow-[0_-4px_12px_rgba(0,0,0,0.05)] z-40 pb-[max(16px,env(safe-area-inset-bottom))]">
        <button
          onClick={handleAddToCart}
          disabled={book.price === null || addCartItem.isPending}
          className={`w-full flex items-center justify-center gap-2 py-[11px] px-6 rounded-lg text-role-button font-bold transition-all shadow-sm ${
            book.price === null 
              ? 'bg-muted text-muted-foreground cursor-not-allowed'
              : 'bg-coral text-coral-foreground hover:bg-coral-hover'
          }`}
        >
          {inCart ? <CheckCircle2 className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
          {inCart ? 'Add another to cart' : 'Add to cart'}
        </button>
      </div>

    </div>
  );
}
