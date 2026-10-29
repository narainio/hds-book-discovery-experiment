/**
 * All presenter-demo content in one module. Swap products, labels and images
 * here; no other file needs to change.
 */
export const DEMO_USER = { firstName: 'Catherine' } as const;

/** Weekly delivery slot (local time). day: 0 = Sunday … 6 = Saturday. */
export const DELIVERY_SLOT = {
  day: 2,
  dayLabel: 'Tue',
  windowLabel: '7–8 PM',
  cutoffHour: 14,
  cutoffLabel: '2 PM',
} as const;

/** Latest publication year in the inspected catalog (not the clock or the loaded page). */
export const CATALOG_LATEST_YEAR = 2026;

const base = (import.meta.env?.BASE_URL ?? '/').replace(/\/?$/, '/');
const img = (name: string) => `${base}landing/${name}.webp`;

export interface FeaturedCard {
  id: string;
  eyebrow: string;
  title: string;
  subtext: string;
  cta: string;
  feature: string;
  variant: 'primary' | 'outline';
  image: string;
  alt: string;
  fallback: string;
}

export const FEATURED: readonly FeaturedCard[] = [
  {
    id: 'pizza', eyebrow: 'For dinner', title: 'My Pizza', subtext: 'Choose your own ingredients.',
    cta: 'Create my pizza', feature: 'Create my pizza', variant: 'primary',
    image: img('pizza'), alt: 'A stone-baked pizza with tomatoes, mozzarella and basil on a wooden board', fallback: '#FCE6DA',
  },
  {
    id: 'backpack', eyebrow: 'For school', title: 'Premium backpack for class', subtext: 'Durable. Comfortable. Built to last.',
    cta: 'Explore', feature: 'Premium backpacks', variant: 'outline',
    image: img('backpack'), alt: 'A navy backpack with tan leather trim beside a stack of books', fallback: '#DDEBFA',
  },
];

export interface Tile { id: string; title: string; sub: string; image: string; fallback: string }

export const TILES: readonly Tile[] = [
  { id: 'produce', title: 'Seasonal produce', sub: 'Fresh picks', image: img('strawberries'), fallback: '#FCE6DA' },
  { id: 'meals', title: 'Healthy meals', sub: 'Quick and easy', image: img('bowl'), fallback: '#E6F2E4' },
  { id: 'activewear', title: 'Activewear', sub: 'Top brands', image: img('shoe'), fallback: '#DDEBFA' },
  { id: 'household', title: 'Household goods', sub: 'Everyday essentials', image: img('towels'), fallback: '#F2F6FC' },
  { id: 'electronics', title: 'Electronics', sub: 'Brand store', image: img('earbuds'), fallback: '#FCE6DA' },
];

export const PLACEHOLDER_FILTERS = ['Weeknight dinners', 'Household restock'] as const;
export const PLACEHOLDER_SKUS = ['Organic strawberries', 'Whole milk, 1 gal', 'Sourdough loaf', 'Laundry pods'] as const;
export const PLACEHOLDER_LISTS = ['Back to school', 'Weekend groceries', 'Birthday party'] as const;

export const SETTINGS_USERS = ['Catherine (admin)', 'Henry (admin)', 'Johnny'] as const;
export const SETTINGS_AGENTS = ['Cathbot (HDS)', 'Henrybot (Muse)'] as const;
