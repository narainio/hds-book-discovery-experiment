import { getDiscover, setFilter } from '@workspace/api-client-react';
import type { DiscoverResponse } from '@workspace/api-client-react';
import type { FilterAdapter, FilterInput, FilterResult } from '@/lib/filter-controller';
import { normalizeWords } from '@/lib/filter-controller';

export const MAX_WORDS_LENGTH = 2000;
export const PAGE_SIZE = 24;

function toResult(discover: DiscoverResponse): FilterResult {
  return { session: discover.session, discover };
}

/**
 * Atomic adapter: POST /session/{id}/filter applies the FULL desired Filter in
 * one transaction and returns session + matching results together. GET
 * /discover returns the committed inputs and results for reconciliation.
 */
export function createFilterAdapter(sessionId: string, onResult: (r: FilterResult) => void): FilterAdapter {
  return {
    read: async () => toResult(await getDiscover({ sessionId })),
    readPage: async (offset: number) => toResult(await getDiscover({ sessionId, offset, limit: PAGE_SIZE })),
    commit: async (desired: FilterInput) => toResult(await setFilter(sessionId, {
      queryText: (normalizeWords(desired.words) ?? '').slice(0, MAX_WORDS_LENGTH),
      pivotWorkId: desired.book?.id ?? null,
      ...(desired.clearNegatives ? { clearNegatives: true } : {}),
    })),
    onResult,
  };
}
