import { DELIVERY_SLOT } from './demo-content';

/** Greeting by the browser's local clock. */
export function greetingFor(date: Date): string {
  const h = date.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

/** The next order cutoff (this week's if still ahead, else next week's). */
export function nextCutoff(now: Date, slot: { day: number; cutoffHour: number } = DELIVERY_SLOT): Date {
  const c = new Date(now.getFullYear(), now.getMonth(), now.getDate(), slot.cutoffHour, 0, 0, 0);
  c.setDate(c.getDate() + ((slot.day - now.getDay() + 7) % 7));
  if (c.getTime() <= now.getTime()) c.setDate(c.getDate() + 7);
  return c;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "1 day, 6 hrs" (> 24 h), "5 hrs" (1–24 h), "45 min" (< 1 h). */
export function formatCountdown(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  if (totalMin < 60) return `${totalMin} min`;
  const totalHrs = Math.floor(totalMin / 60);
  if (totalMin <= 24 * 60) return plural(totalHrs, 'hr');
  const days = Math.floor(totalHrs / 24);
  const hrs = totalHrs % 24;
  return hrs ? `${plural(days, 'day')}, ${plural(hrs, 'hr')}` : plural(days, 'day');
}

export function deliveryCountdown(now: Date, slot: { day: number; cutoffHour: number } = DELIVERY_SLOT) {
  const cutoff = nextCutoff(now, slot);
  return { cutoff, label: formatCountdown(cutoff.getTime() - now.getTime()) };
}
