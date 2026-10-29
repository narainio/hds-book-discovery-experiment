import type { FilterInput } from '@/lib/filter-controller';
import { normalizeWords } from '@/lib/filter-controller';
import type { WorkingContext } from '@/lib/working-context';
import { composeQuery } from '@/lib/intention';

function shortTitle(title: string): string {
  return title.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

/** Short factual description of the working discovery (not a saved Mode). */
export function contextSummary(ctx: WorkingContext | null, filter: FilterInput | null, negativeCount = 0): string {
  const parts: string[] = [];
  if (ctx?.sourceModeName) parts.push(`Started from ${ctx.sourceModeName}`);
  const words = ctx ? composeQuery(ctx.base, ctx.refinements) : normalizeWords(filter?.words);
  if (words) parts.push(`“${words}”`);
  if (!words && !ctx?.sourceModeName) parts.push('All books');
  if (filter?.book) parts.push(`In Filter: ${shortTitle(filter.book.title)}`);
  if (negativeCount > 0) parts.push(`${negativeCount} fewer like this`);
  return parts.join(' · ');
}
