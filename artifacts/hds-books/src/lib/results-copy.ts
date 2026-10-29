/**
 * Results count and catalog-scope copy. The total is the server's
 * totalAvailable (every eligible ranked book for the committed Filter), never
 * a number derived from the loaded page; ranking is soft, so it is not a
 * "matching" total.
 */
export function resultsCountText(shown: number, total: number | null | undefined): string {
  const n = shown.toLocaleString('en-US');
  if (typeof total === 'number' && total > shown) return `${n} of ${total.toLocaleString('en-US')} books shown`;
  return `${n} book${shown === 1 ? '' : 's'} shown`;
}

/** Catalog information from the engine's grade label (e.g. "age 10 · grades 4–5"), or null. */
export function catalogScope(gradeLabel: string | null | undefined): string | null {
  const grades = (gradeLabel ?? '').split('·').map((part) => part.trim()).find((part) => /^grades?\s/i.test(part));
  return grades ? `Catalog: ${grades}` : null;
}
