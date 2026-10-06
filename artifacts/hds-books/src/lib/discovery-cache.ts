import type { QueryClient } from '@tanstack/react-query';
import {
  getGetCartQueryKey,
  getGetSessionQueryKey,
} from '@workspace/api-client-react';
import type {
  CartView,
  SessionState,
} from '@workspace/api-client-react';

export function setSessionState(
  queryClient: QueryClient,
  sessionId: string,
  session: SessionState,
) {
  queryClient.setQueryData(getGetSessionQueryKey(sessionId), session);
}

/**
 * Cart mutations return the complete CartView. Store it directly and derive
 * the header's cart fields without issuing follow-up cart/session requests.
 */
export function setCartState(
  queryClient: QueryClient,
  sessionId: string,
  cart: CartView,
) {
  queryClient.setQueryData(getGetCartQueryKey(sessionId), cart);
  queryClient.setQueryData<SessionState>(
    getGetSessionQueryKey(sessionId),
    (current) => current
      ? {
          ...current,
          cartCount: cart.itemCount,
          cartIds: cart.items.map((line) => line.book.id),
        }
      : current,
  );
}