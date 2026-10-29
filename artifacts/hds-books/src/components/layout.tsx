import React, { useEffect, useRef } from 'react';
import { Link, useLocation } from 'wouter';
import { LayoutGrid, ShoppingCart } from 'lucide-react';
import { DeliveryBlock } from '@/components/delivery-block';
import { SettingsMenu } from '@/components/settings-menu';
import { useSession } from '@/hooks/use-session';

export default function Layout({ children }: { children: React.ReactNode }) {
  const { session, isLoading } = useSession();
  const [loc] = useLocation();
  const layoutRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const layout = layoutRef.current;
    if (!layout) return;
    const headers = layout.querySelectorAll<HTMLElement>('[data-top-navigation]');
    const measure = () => {
      const height = Math.max(...Array.from(headers, header => header.getBoundingClientRect().height));
      layout.style.setProperty('--top-navigation-height', `${height}px`);
    };
    const observer = new ResizeObserver(measure);
    headers.forEach(header => observer.observe(header));
    measure();
    return () => observer.disconnect();
  }, []);

  const cartCount = session?.cartCount || 0;

  // Route changes move focus to the destination heading without scrolling.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    let tries = 0;
    const focusHeading = () => {
      const heading = document.querySelector<HTMLElement>('main h1');
      if (!heading) { if (tries++ < 20) window.setTimeout(focusHeading, 50); return; }
      if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    };
    const id = window.setTimeout(focusHeading, 0);
    return () => window.clearTimeout(id);
  }, [loc]);

  const cartLink = (mobile: boolean) => (
    <Link href="/cart" aria-label={mobile ? `Cart${cartCount ? `, ${cartCount} items` : ''}` : undefined} data-testid="link-cart"
      className="flex items-center gap-2 text-foreground rounded-full px-2 min-h-[44px] min-w-[44px] justify-center hover:bg-white/70">
      <span className="relative">
        <ShoppingCart className="w-6 h-6" strokeWidth={1.75} aria-hidden="true" />
        {cartCount > 0 && (
          <span className="absolute -top-2 -right-2.5 bg-teal text-teal-foreground text-[14px] font-bold min-w-[22px] h-[22px] px-1 flex items-center justify-center rounded-full leading-none" data-testid="badge-cart-count">
            {cartCount}
          </span>
        )}
      </span>
      {!mobile && <span className="text-[17px] font-semibold">Cart</span>}
    </Link>
  );
  const onThings = loc === '/my-things';

  return (
    <div ref={layoutRef} className="min-h-[100dvh] flex flex-col bg-background">
      <header data-top-navigation className="header-gradient sticky top-0 z-50 border-b border-border">
        <div className="max-w-[1440px] mx-auto w-full flex items-center gap-1 md:gap-3 h-[60px] md:h-[84px] px-3 md:px-8">
          <Link href="/" aria-label="HDS Home" data-testid="link-logo-home" className="font-brand text-[26px] md:text-[34px] font-extrabold tracking-tight text-coral min-h-11 flex items-center px-1">
            HDS
          </Link>
          <span aria-hidden="true" className="hidden md:block h-9 w-px bg-border mx-3" />
          <Link href="/my-things" aria-current={onThings ? 'page' : undefined} data-testid="link-my-things"
            className={'min-h-11 px-2 md:px-3 inline-flex items-center gap-1.5 rounded-full text-[17px] md:text-[22px] font-semibold text-foreground hover:bg-white/70 ' + (onThings ? 'underline decoration-2 underline-offset-8 decoration-coral' : '')}>
            <LayoutGrid className="w-5 h-5 md:hidden" aria-hidden="true" />
            My things
          </Link>
          <div className="flex-1" />
          <div className="hidden md:block"><DeliveryBlock /></div>
          <span aria-hidden="true" className="hidden md:block h-9 w-px bg-border mx-1" />
          <span className="md:hidden">{cartLink(true)}</span>
          <span className="hidden md:block">{cartLink(false)}</span>
          <span aria-hidden="true" className="hidden md:block h-9 w-px bg-border mx-1" />
          <span className="md:hidden"><SettingsMenu compact /></span>
          <span className="hidden md:block"><SettingsMenu /></span>
        </div>
      </header>

      <main className="flex-1 w-full max-w-[1440px] mx-auto pb-16 md:pb-24">
        {isLoading ? (
          <div className="p-8 flex flex-col space-y-4 max-w-4xl mx-auto">
            <div className="h-8 bg-muted animate-pulse rounded w-1/3"></div>
            <div className="h-4 bg-muted animate-pulse rounded w-1/2"></div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="aspect-[2/3] bg-muted animate-pulse rounded-md"></div>
              ))}
            </div>
          </div>
        ) : (
          <>
            {children}
          </>
        )}
      </main>
    </div>
  );
}
