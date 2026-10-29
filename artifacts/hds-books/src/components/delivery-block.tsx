import React, { useEffect, useState } from 'react';
import { Info, Truck } from 'lucide-react';
import { ComingSoonButton } from '@/components/coming-soon';
import { DELIVERY_SLOT } from '@/lib/demo-content';
import { deliveryCountdown } from '@/lib/demo-time';

export function DeliveryBlock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const { cutoff, label } = deliveryCountdown(now);
  // Day label follows the slot being counted down to (the cutoff day).
  const day = cutoff.toLocaleDateString('en-US', { weekday: 'short' }) || DELIVERY_SLOT.dayLabel;
  return (
    <ComingSoonButton feature="Scheduling" data-testid="button-delivery"
      className="min-h-11 px-3 py-1 inline-flex items-center gap-3 rounded-xl text-left hover:bg-white/60">
      <Truck className="w-7 h-7 text-foreground shrink-0" strokeWidth={1.6} aria-hidden="true" />
      <span className="leading-tight">
        <span className="block text-role-small text-muted-foreground">Next delivery</span>
        <span className="flex items-center gap-1 text-[18px] font-bold text-foreground">
          {day}, {DELIVERY_SLOT.windowLabel} <Info className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
        </span>
        <span className="block text-role-small text-muted-foreground" data-testid="text-delivery-countdown">
          Order by {DELIVERY_SLOT.cutoffLabel} ({label} left)
        </span>
      </span>
    </ComingSoonButton>
  );
}
