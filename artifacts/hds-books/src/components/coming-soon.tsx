import React from 'react';
import { toast } from '@/hooks/use-toast';

export function comingSoonMessage(feature: string): string {
  return `${feature} is coming soon in this demo.`;
}

/** Shows the polite "coming soon" toast. Never navigates or moves focus. */
export function showComingSoon(feature: string) {
  toast({ description: comingSoonMessage(feature), type: 'background', duration: 3500 });
}

type Props = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'type'> & { feature: string };

/** A real button for anything off the live path. */
export const ComingSoonButton = React.forwardRef<HTMLButtonElement, Props>(function ComingSoonButton({ feature, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      data-coming-soon=""
      onClick={(e) => { e.preventDefault(); showComingSoon(feature); }}
      {...rest}
    />
  );
});

export function ComingSoonTag() {
  return (
    <span className="shrink-0 inline-flex items-center rounded-full border border-border bg-secondary px-2 py-0.5 text-role-small font-medium text-muted-foreground" data-testid="tag-coming-soon">
      Coming soon
    </span>
  );
}
