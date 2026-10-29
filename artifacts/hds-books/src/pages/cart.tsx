import React from 'react';
import { Link, useLocation } from 'wouter';
import { Trash2, Minus, Plus } from 'lucide-react';
import { useSession } from '@/hooks/use-session';
import { 
  useGetCart, 
  useUpdateCartItem,
  useRemoveCartItem,
  getGetCartQueryKey,
  getGetSessionQueryKey
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { PriceDisplay } from '@/components/price-display';

export default function Cart() {
  const { session, sessionId } = useSession();
  const queryClient = useQueryClient();
  const [, setLoc] = useLocation();

  const { data: cart, isLoading } = useGetCart(sessionId || '', {
    query: { enabled: !!sessionId, queryKey: getGetCartQueryKey(sessionId || '') }
  });

  const updateItem = useUpdateCartItem();
  const removeItem = useRemoveCartItem();

  const handleUpdateQuantity = (bookId: string, quantity: number) => {
    if (!sessionId || quantity < 1) return;
    updateItem.mutate({ sessionId, bookId, data: { quantity } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetCartQueryKey(sessionId) });
        queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey(sessionId) });
      }
    });
  };

  const handleRemove = (bookId: string) => {
    if (!sessionId) return;
    removeItem.mutate({ sessionId, bookId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetCartQueryKey(sessionId) });
        queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey(sessionId) });
      }
    });
  };

  if (isLoading) {
    return (
      <div className="p-8 max-w-4xl mx-auto animate-pulse">
        <div className="h-10 bg-muted rounded w-1/4 mb-12"></div>
        <div className="space-y-6">
          {[1, 2].map(i => (
            <div key={i} className="flex gap-6 border-b border-border pb-6">
              <div className="w-20 h-28 bg-muted rounded"></div>
              <div className="flex-1 space-y-4 py-2">
                <div className="h-5 bg-muted rounded w-1/2"></div>
                <div className="h-4 bg-muted rounded w-1/4"></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const isEmpty = !cart || cart.items.length === 0;

  return (
    <div className="w-full max-w-5xl mx-auto p-4 md:p-8">
      <h1 className="text-role-page-title mb-8">Cart</h1>

      {isEmpty ? (
        <div className="text-center py-24 bg-card border border-border rounded-xl">
          <h2 className="text-role-section-title mb-3">Your cart is empty</h2>
          <p className="text-role-body-large text-muted-foreground mb-8">Ready to find some great books?</p>
          <Link href="/discover" className="inline-flex items-center justify-center px-6 py-3 bg-coral text-coral-foreground font-semibold rounded-lg hover:bg-coral-hover transition-colors shadow-sm">
            Start shopping
          </Link>
        </div>
      ) : (
        <div className="flex flex-col lg:flex-row gap-8 lg:gap-12">
          {/* Cart Items */}
          <div className="flex-1 min-w-0">
            <div className="hidden md:grid grid-cols-[minmax(0,1fr)_6.5rem_7.75rem_4.5rem] gap-4 pb-4 border-b border-border text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              <div>Item</div>
              <div className="text-center">Price</div>
              <div className="text-center">Quantity</div>
              <div className="text-right">Total</div>
            </div>

            <ul className="divide-y divide-border">
              {cart.items.map((line) => (
                <li key={line.book.id} className="py-6 flex flex-col md:grid md:grid-cols-[minmax(0,1fr)_6.5rem_7.75rem_4.5rem] md:items-center gap-4">
                  {/* Item Info */}
                  <div className="min-w-0 flex gap-4">
                    <Link href={`/book/${line.book.id}`} className="shrink-0 w-20 aspect-[2/3] bg-secondary rounded flex items-center justify-center overflow-hidden border border-border/50 hover:opacity-90 transition-opacity">
                      {line.book.hasCover && line.book.coverImageUrl ? (
                        <img src={line.book.coverImageUrl} alt={line.book.title} className="w-full h-full object-contain mix-blend-multiply" />
                      ) : (
                        <span className="text-role-small text-muted-foreground text-center px-1 line-clamp-3">{line.book.title}</span>
                      )}
                    </Link>
                    <div className="flex flex-col justify-center min-w-0">
                      <Link href={`/book/${line.book.id}`} className="text-role-card-title text-foreground hover:underline decoration-1 underline-offset-2 mb-1 line-clamp-2">
                        {line.book.title}
                      </Link>
                      <p className="text-role-metadata text-muted-foreground mb-1 line-clamp-1">{line.book.formatLabel}</p>
                      <button
                        onClick={() => handleRemove(line.book.id)}
                        className="text-role-small text-muted-foreground hover:text-destructive flex items-center gap-1 mt-2 w-fit transition-colors"
                      >
                        <Trash2 className="w-4 h-4" /> Remove
                      </button>
                    </div>
                  </div>
                  
                  {/* Price (desktop only, hidden mobile) */}
                  <div className="min-w-0 hidden md:block text-center font-medium">
                    <PriceDisplay
                      price={line.book.price}
                      catalogPrice={line.book.catalogPrice}
                      currency={line.book.currency}
                      size="compact"
                      align="center"
                       className="[&>div]:flex-col"
                    />
                  </div>
                  
                  {/* Quantity & Mobile Price/Total */}
                  <div className="flex items-center justify-between md:justify-center gap-3 w-full">
                    <div className="flex md:hidden flex-col">
                      <span className="text-sm text-muted-foreground">Price</span>
                      <PriceDisplay
                        price={line.book.price}
                        catalogPrice={line.book.catalogPrice}
                        currency={line.book.currency}
                        size="compact"
                      />
                    </div>

                    <div className="shrink-0 flex items-center border border-border rounded-md bg-card h-[44px]">
                      <button 
                        onClick={() => handleUpdateQuantity(line.book.id, line.quantity - 1)}
                        disabled={line.quantity <= 1}
                        className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
                      >
                        <Minus className="w-[18px] h-[18px]" strokeWidth={2} />
                      </button>
                      <span className="w-8 text-center font-medium text-role-ui">{line.quantity}</span>
                      <button 
                        onClick={() => handleUpdateQuantity(line.book.id, line.quantity + 1)}
                        className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <Plus className="w-[18px] h-[18px]" strokeWidth={2} />
                      </button>
                    </div>
                  </div>
                  
                  {/* Total */}
                  <div className="flex items-center justify-between md:justify-end">
                    <span className="text-sm text-muted-foreground md:hidden">Total</span>
                    <span className="font-semibold text-lg md:text-base">
                      {new Intl.NumberFormat('en-US', { style: 'currency', currency: cart.currency || 'USD' }).format(line.lineTotal)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Summary Sidebar */}
          <div className="lg:w-80 shrink-0">
            <div className="bg-card border border-border rounded-xl p-6 sticky top-24">
              <h2 className="text-role-subsection-title mb-6">Order summary</h2>
              
              <div className="flex items-center justify-between mb-4 text-role-metadata text-muted-foreground">
                <span>Subtotal ({cart.itemCount} items)</span>
                <span>{new Intl.NumberFormat('en-US', { style: 'currency', currency: cart.currency || 'USD' }).format(cart.subtotal)}</span>
              </div>
              
              <div className="flex items-center justify-between mb-6 text-role-metadata text-muted-foreground">
                <span>Shipping</span>
                <span>Calculated at checkout</span>
              </div>
              
              <div className="pt-4 border-t border-border flex items-center justify-between mb-8">
                <span className="font-semibold text-role-body-large text-foreground">Estimated total</span>
                <span className="font-bold text-role-subsection-title text-foreground">
                  {new Intl.NumberFormat('en-US', { style: 'currency', currency: cart.currency || 'USD' }).format(cart.subtotal)}
                </span>
              </div>
              
              <button 
                onClick={() => setLoc('/checkout')}
                className="w-full py-4 px-6 bg-coral text-coral-foreground font-bold rounded-lg hover:bg-coral-hover transition-colors shadow-sm text-center block mb-3"
              >
                Checkout
              </button>
              <p className="text-role-small text-center text-muted-foreground mt-3">
                Demo only. No real purchase will occur.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
