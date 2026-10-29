import React, { useState } from 'react';
import { Link } from 'wouter';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { useSession } from '@/hooks/use-session';
import { 
  useGetCart,
  useSimulateCheckout,
  getGetCartQueryKey,
  getGetSessionQueryKey
} from '@workspace/api-client-react';
import type { CheckoutResult } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';

export default function Checkout() {
  const { session, sessionId } = useSession();
  const queryClient = useQueryClient();

  const { data: cart, isLoading: isCartLoading } = useGetCart(sessionId || '', {
    query: { enabled: !!sessionId, queryKey: getGetCartQueryKey(sessionId || '') }
  });

  const checkoutMutation = useSimulateCheckout();
  const [result, setResult] = useState<CheckoutResult | null>(null);

  const handleCompleteOrder = () => {
    if (!sessionId) return;
    checkoutMutation.mutate(
      { sessionId },
      {
        onSuccess: (data) => {
          setResult(data);
          queryClient.invalidateQueries({ queryKey: getGetCartQueryKey(sessionId) });
          queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey(sessionId) });
        }
      }
    );
  };

  if (isCartLoading) {
    return <div className="p-8 max-w-2xl mx-auto animate-pulse h-64 bg-muted rounded-xl"></div>;
  }

  if (result) {
    return (
      <div className="w-full max-w-2xl mx-auto p-4 md:p-8 mt-8 md:mt-16 text-center">
        <div className="bg-card border border-border rounded-2xl p-8 md:p-12 shadow-sm">
          <div className="w-16 h-16 bg-success/10 text-success rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <h1 className="text-role-page-title mb-4">Order Confirmed</h1>
          <p className="text-role-body-large text-muted-foreground mb-8">
            {result.message}
          </p>
          
          <div className="bg-secondary/30 rounded-xl p-6 text-left max-w-md mx-auto mb-8 border border-border">
            <div className="flex justify-between py-2 border-b border-border/50">
              <span className="text-muted-foreground font-medium">Order Reference</span>
              <span className="font-mono text-foreground">{result.reference}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-border/50">
              <span className="text-muted-foreground font-medium">Items</span>
              <span className="text-foreground font-medium">{result.itemCount}</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-muted-foreground font-medium">Total</span>
              <span className="text-foreground font-bold">
                {new Intl.NumberFormat('en-US', { style: 'currency', currency: result.currency || 'USD' }).format(result.subtotal)}
              </span>
            </div>
          </div>
          
          <div className="flex items-center justify-center gap-2 text-role-ui text-foreground mb-8 bg-coral/10 py-3 rounded-lg border border-coral/20">
            <AlertCircle className="w-4 h-4" />
            Demo: No payment was collected.
          </div>

          <Link href="/discover" className="inline-flex items-center justify-center px-8 py-3.5 bg-teal text-teal-foreground font-semibold rounded-lg hover:bg-teal-hover transition-colors">
            Return to Discovery
          </Link>
        </div>
      </div>
    );
  }

  if (!cart || cart.items.length === 0) {
    return (
      <div className="w-full max-w-2xl mx-auto p-8 text-center mt-12">
        <h2 className="text-role-section-title mb-4">Cart is empty</h2>
        <Link href="/discover" className="text-teal hover:underline font-medium">Return to discovery</Link>
      </div>
    );
  }

  return (
    <div className="w-full max-w-3xl mx-auto p-4 md:p-8">
      <h1 className="text-role-page-title text-foreground mb-8">Checkout</h1>
      
      <div className="bg-coral/10 border border-coral/30 rounded-xl p-6 mb-8 text-foreground flex items-start gap-4">
        <AlertCircle className="w-6 h-6 shrink-0 mt-0.5" />
        <div>
          <h2 className="text-role-ui mb-1">This is a prototype demo</h2>
          <p className="opacity-90">
            No real order will be placed. You do not need to enter payment, shipping, or personal information. 
            Clicking the button below will simulate a successful transaction.
          </p>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-6 md:p-8">
        <h2 className="text-role-subsection-title mb-6">Review Demo Order</h2>
        
        <div className="divide-y divide-border mb-8">
          {cart.items.map(line => (
            <div key={line.book.id} className="py-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-16 bg-secondary rounded border border-border flex items-center justify-center overflow-hidden shrink-0">
                  {line.book.hasCover && line.book.coverImageUrl ? (
                    <img src={line.book.coverImageUrl} alt="" className="w-full h-full object-contain mix-blend-multiply" />
                  ) : (
                    <span className="text-role-small text-muted-foreground p-1 text-center">{line.book.title}</span>
                  )}
                </div>
                <div>
                  <h3 className="text-role-card-title text-foreground">{line.book.title}</h3>
                  <p className="text-role-small text-muted-foreground">Qty: {line.quantity}</p>
                </div>
              </div>
              <div className="text-role-ui text-foreground">
                {new Intl.NumberFormat('en-US', { style: 'currency', currency: cart.currency || 'USD' }).format(line.lineTotal)}
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-border pt-6 flex justify-between items-center mb-8">
          <span className="text-role-ui text-foreground">Total</span>
          <span className="text-role-price text-2xl text-foreground">
            {new Intl.NumberFormat('en-US', { style: 'currency', currency: cart.currency || 'USD' }).format(cart.subtotal)}
          </span>
        </div>

        <button
          onClick={handleCompleteOrder}
          disabled={checkoutMutation.isPending}
          className="w-full py-4 px-6 bg-coral text-coral-foreground text-role-button rounded-lg hover:bg-coral-hover transition-colors shadow-sm disabled:opacity-70 flex items-center justify-center"
        >
          {checkoutMutation.isPending ? 'Processing...' : 'Complete Demo Order'}
        </button>
      </div>
    </div>
  );
}
