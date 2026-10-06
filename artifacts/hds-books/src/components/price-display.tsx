import React from 'react';
import { SAVINGS_LABEL } from '@workspace/pricing';

type PriceDisplayProps = {
  price: number | null;
  catalogPrice: number | null;
  currency?: string;
  size?: 'compact' | 'default' | 'large';
  align?: 'start' | 'center' | 'end';
  className?: string;
};

export function formatPrice(price: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(price);
}

export function PriceDisplay({
  price,
  catalogPrice,
  currency = 'USD',
  size = 'default',
  align = 'start',
  className = '',
}: PriceDisplayProps) {
  if (price === null) {
    return (
      <span className={`text-role-metadata text-muted-foreground ${className}`}>
        Unavailable
      </span>
    );
  }

  const salePriceClass = {
    compact: 'text-role-price',
    default: 'text-role-price',
    large: 'text-role-price',
  }[size];
  const alignmentClass = {
    start: 'items-start',
    center: 'items-center',
    end: 'items-end',
  }[align];

  return (
    <div className={`flex flex-col ${alignmentClass} ${className}`}>
      <div className="flex flex-nowrap items-center gap-2">
        <span className={`${salePriceClass} font-bold text-foreground`}>
          <span className="sr-only">Current price:</span>
          {formatPrice(price, currency)}
        </span>
        <span className="rounded-[6px] bg-coral px-[9px] py-[6px] text-[15px] font-bold text-coral-foreground whitespace-nowrap leading-none">
          {SAVINGS_LABEL}
        </span>
      </div>
      {catalogPrice !== null && (
        <del className="text-role-metadata text-muted-foreground decoration-destructive/70 mt-0.5">
          <span className="sr-only">Original price:</span>
          {formatPrice(catalogPrice, currency)}
        </del>
      )}
    </div>
  );
}