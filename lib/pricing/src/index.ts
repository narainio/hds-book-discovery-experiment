/** The single standard catalog discount used by the API and customer UI. */
export const STANDARD_DISCOUNT_RATE = 0.2;

const DISCOUNT_PERCENTAGE = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 2,
}).format(STANDARD_DISCOUNT_RATE);

/** Customer-visible savings copy, derived from the applied discount rate. */
export const SAVINGS_LABEL = `Save ${DISCOUNT_PERCENTAGE}`;

/**
 * Applies the standard discount while preserving the existing API's
 * decimal-to-cents rounding behavior.
 */
export function discountedPrice(price: number | null): number | null {
  return price === null
    ? null
    : Number((price * (1 - STANDARD_DISCOUNT_RATE)).toFixed(2));
}