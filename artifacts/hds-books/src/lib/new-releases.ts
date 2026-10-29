import { CATALOG_LATEST_YEAR } from './demo-content';

export const NEW_RELEASE_WINDOW = 24;
export const NEW_RELEASE_MAX = 8;
export const NEW_RELEASE_MIN = 3;

type WithYear = { book: { id: string; publicationYear?: number | null } };

/**
 * Up to eight books from the first 24 loaded results published in the two most
 * recent catalog years, in rank order. Empty when fewer than three qualify.
 * Never reorders or removes anything from the input.
 */
export function pickNewReleases<T extends WithYear>(results: readonly T[], latestYear = CATALOG_LATEST_YEAR): T[] {
  const picked = results
    .slice(0, NEW_RELEASE_WINDOW)
    .filter((r) => {
      const y = r.book.publicationYear;
      return typeof y === 'number' && y >= latestYear - 1 && y <= latestYear;
    })
    .slice(0, NEW_RELEASE_MAX);
  return picked.length >= NEW_RELEASE_MIN ? picked : [];
}
