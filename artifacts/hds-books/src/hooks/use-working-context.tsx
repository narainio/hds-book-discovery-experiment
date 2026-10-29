import React, { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import { getBook } from '@workspace/api-client-react';
import type { BookThumb } from '@workspace/api-client-react';
import { useSession } from '@/hooks/use-session';
import { useFilterController } from '@/hooks/use-your-filter';
import { composeQuery } from '@/lib/intention';
import { getModeRepository, copyMode } from '@/lib/modes';
import type { ModeDefinition, ModesState } from '@/lib/modes';
import { WorkingContextStore, effectiveWords } from '@/lib/working-context';
import type { WorkingContextState, ContextProposal } from '@/lib/working-context';

/** The demo Mode seeded once per browser profile, from the engine's actual mode. */
export const SEED_MODE_NAME = 'Books for Johnny';

export interface EntryActions {
  /** New Home intention: replaces words, example, negatives and Mode provenance; Cart stays. */
  startIntention: (text: string) => void;
  /** All books in the catalog: no words, example, negatives or Mode provenance; Cart stays. */
  browseAll: () => void;
  /** Same engine state as Browse all books, started from discovery. */
  startOver: () => void;
  /** Copy a saved Mode into a new independent working Filter. */
  openMode: (mode: ModeDefinition) => Promise<{ ok: true } | { ok: false; message: string }>;
  /** Replace text-derived criteria; keeps the example book and negatives. */
  editIntention: (text: string | null) => void;
  /** Add one textual refinement to the existing intention. */
  addRefinement: (text: string) => void;
}

interface WorkingContextValue {
  store: WorkingContextStore | null;
  actions: EntryActions;
}

const Ctx = createContext<WorkingContextValue | null>(null);

const EMPTY_STATE: WorkingContextState = { committed: null, proposal: null, notice: null };
const noopSubscribe = () => () => {};

function storage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

function isNotFound(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'status' in error && (error as { status: unknown }).status === 404;
}

export function WorkingContextProvider({ children }: { children: React.ReactNode }) {
  const { sessionId, session } = useSession();
  const controller = useFilterController();
  const store = useMemo(() => (sessionId ? new WorkingContextStore(storage(), sessionId) : null), [sessionId]);

  // Every committed view the Filter controller shows is reconciled here.
  useEffect(() => {
    if (!store) return;
    let last = controller.getSnapshot().view;
    if (last) store.observe(last.filter);
    return controller.subscribe(() => {
      const view = controller.getSnapshot().view;
      if (view && view !== last) {
        last = view;
        store.observe(view.filter);
      }
    });
  }, [store, controller]);

  useEffect(() => {
    if (!store) return;
    const save = () => store.persist();
    window.addEventListener('pagehide', save);
    return () => window.removeEventListener('pagehide', save);
  }, [store]);

  // Seed the documented demo Mode once, from the engine's actual configuration.
  useEffect(() => {
    if (!session) return;
    getModeRepository().ensureSeeded({
      name: SEED_MODE_NAME,
      baseIntention: null,
      refinements: [],
      context: { modeId: session.modeId, label: session.modeLabel },
      selectedProductIds: [],
    });
  }, [session?.modeId, session?.modeLabel]);

  const replace = useCallback((proposal: Omit<ContextProposal, 'replace'>, book: BookThumb | null, notice: string | null = null) => {
    if (!store) return;
    store.propose({ ...proposal, replace: true, bookId: book?.id ?? null }, notice);
    controller.replace({ words: composeQuery(proposal.base, proposal.refinements), book });
  }, [store, controller]);

  const actions = useMemo<EntryActions>(() => {
    const blank = { sourceModeId: null, sourceModeName: null, sourceModeContext: null };
    return {
      startIntention: (text) => replace({ ...blank, base: text, refinements: [], origin: 'intention' }, null),
      browseAll: () => replace({ ...blank, base: null, refinements: [], origin: 'browse' }, null),
      startOver: () => replace({ ...blank, base: null, refinements: [], origin: 'browse' }, null),
      openMode: async (saved) => {
        const mode = copyMode(saved);
        let book: BookThumb | null = null;
        let notice: string | null = null;
        const id = mode.selectedProductIds[0];
        if (id) {
          try {
            const found = await getBook(id);
            book = { id: found.id, title: found.title, coverImageUrl: found.coverImageUrl ?? null };
          } catch (error) {
            if (!isNotFound(error)) {
              return { ok: false, message: 'This Mode couldn’t be opened. Your current discovery and Cart are unchanged.' };
            }
            notice = 'The book saved in this Mode is no longer available, so it was left out.';
          }
        }
        replace({
          base: mode.baseIntention,
          refinements: mode.refinements,
          sourceModeId: mode.id,
          sourceModeName: mode.name,
          sourceModeContext: mode.context,
          origin: 'mode',
        }, book, notice);
        return { ok: true };
      },
      editIntention: (text) => {
        if (!store) return;
        const { proposal, committed } = store.getSnapshot();
        // Build on the newest requested context, else the committed one.
        const current = proposal ?? committed;
        store.propose({
          base: text,
          refinements: [],
          sourceModeId: current?.sourceModeId ?? null,
          sourceModeName: current?.sourceModeName ?? null,
          sourceModeContext: current?.sourceModeContext ?? null,
          origin: current?.origin ?? 'intention',
          replace: false,
        });
        if (text) controller.setWords(text);
        else controller.clearWords();
      },
      addRefinement: (text) => {
        if (!store) return;
        const { proposal, committed } = store.getSnapshot();
        // Build on the newest requested context, else the committed one.
        const current = proposal ?? committed;
        const refinements = [...(current?.refinements ?? []), text];
        const base = current?.base ?? null;
        store.propose({
          base,
          refinements,
          sourceModeId: current?.sourceModeId ?? null,
          sourceModeName: current?.sourceModeName ?? null,
          sourceModeContext: current?.sourceModeContext ?? null,
          origin: current?.origin ?? 'intention',
          replace: false,
        });
        controller.setWords(composeQuery(base, refinements));
      },
    };
  }, [store, controller, replace]);

  const value = useMemo(() => ({ store, actions }), [store, actions]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function useCtx(): WorkingContextValue {
  const value = useContext(Ctx);
  if (!value) throw new Error('useWorkingContext must be used within WorkingContextProvider');
  return value;
}

export function useWorkingContext(): WorkingContextState & { store: WorkingContextStore | null; actions: EntryActions; effective: string | null } {
  const { store, actions } = useCtx();
  const state = useSyncExternalStore(store?.subscribe ?? noopSubscribe, store?.getSnapshot ?? (() => EMPTY_STATE), store?.getSnapshot ?? (() => EMPTY_STATE));
  return { ...state, store, actions, effective: effectiveWords(state.committed) };
}

export function useModes(): ModesState {
  const repo = getModeRepository();
  return useSyncExternalStore(repo.subscribe, repo.getSnapshot, repo.getSnapshot);
}
