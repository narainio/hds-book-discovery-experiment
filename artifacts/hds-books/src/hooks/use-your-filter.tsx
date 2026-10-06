import React, { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetDiscoverQueryKey } from '@workspace/api-client-react';
import { useSession } from '@/hooks/use-session';
import { setSessionState } from '@/lib/discovery-cache';
import { createFilterAdapter } from '@/lib/filter-api';
import { FilterController } from '@/lib/filter-controller';
import type { FilterSnapshot } from '@/lib/filter-controller';

const noopAdapter = {
  read: () => Promise.reject(new Error('No session')),
  commit: () => Promise.reject(new Error('No session')),
};

const FilterContext = createContext<FilterController | null>(null);

export function YourFilterProvider({ children }: { children: React.ReactNode }) {
  const { sessionId } = useSession();
  const queryClient = useQueryClient();
  const controller = useMemo(() => new FilterController(noopAdapter), [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    controller.setAdapter(createFilterAdapter(sessionId, (result) => {
      setSessionState(queryClient, sessionId, result.session);
      queryClient.setQueryData(getGetDiscoverQueryKey({ sessionId }), result.discover);
    }));
    void controller.load();
  }, [controller, sessionId, queryClient]);

  return <FilterContext.Provider value={controller}>{children}</FilterContext.Provider>;
}

export function useFilterController(): FilterController {
  const controller = useContext(FilterContext);
  if (!controller) throw new Error('useYourFilter must be used within YourFilterProvider');
  return controller;
}

export function useYourFilter(): FilterSnapshot & { controller: FilterController } {
  const controller = useFilterController();
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  return { ...snapshot, controller };
}

/** Move focus to the Your Filter panel (used by header nav and /picks). */
export function focusYourFilter() {
  window.setTimeout(() => {
    const el = document.getElementById('your-filter');
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    el.focus({ preventScroll: true });
  }, 50);
}
