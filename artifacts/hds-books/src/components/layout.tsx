import React, { useEffect, useRef } from 'react';
import { Link, useLocation } from 'wouter';
import { ShoppingCart } from 'lucide-react';
import { useSession } from '@/hooks/use-session';
import { useWorkingContext } from '@/hooks/use-working-context';
import { normalizeWords } from '@/lib/filter-controller';
import { useYourFilter } from '@/hooks/use-your-filter';

export default function Layout({ children }: { children: React.ReactNode }) {
  const { session, isLoading } = useSession();
  const { committed, effective } = useWorkingContext();
  const { view } = useYourFilter();
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
  // The context label names a saved Mode only while the working Filter still
  // comes from it; otherwise it is neutral. Never a fixed "Book for Johnny".
  const fromMode = !!committed?.sourceModeName && normalizeWords(effective) === normalizeWords(view?.filter.words);
  const activeLabel = fromMode ? committed!.sourceModeName! : 'Books';
  const onDiscover = loc === '/discover';

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

  const contextLabel = (
    <p className="flex items-center gap-1.5 text-role-ui text-foreground font-semibold min-w-0" data-testid="text-context-label">
      <span className="sr-only">Shopping context: </span>
      <span className="truncate">{activeLabel}</span>
    </p>
  );

  return (
    <div ref={layoutRef} className="min-h-[100dvh] flex flex-col bg-background">
      {/* Desktop Header (hidden on mobile) */}
      <header data-top-navigation className="hidden md:flex items-center h-[72px] px-6 lg:px-8 border-b border-border bg-card sticky top-0 z-50 shadow-sm">
        <div className="flex-1 flex items-center max-w-[1440px] mx-auto w-full">
          <Link href="/" aria-label="HDS Home" data-testid="link-logo-home" className="font-brand text-2xl font-bold tracking-tight text-coral mr-8">
            HDS
          </Link>
          
          {contextLabel}

          <div className="flex-1" />
          
          <nav className="flex items-center gap-2">
            {onDiscover && (
              <Link href="/" data-testid="link-home" className="min-h-[44px] px-3 inline-flex items-center text-role-ui text-muted-foreground hover:text-foreground underline-offset-2 hover:underline">Home</Link>
            )}
            <Link href="/cart" className="flex items-center gap-2 text-foreground hover:text-coral transition-colors group p-2 min-h-[44px] min-w-[44px] justify-center">
              <div className="relative">
                <ShoppingCart className="w-6 h-6 text-muted-foreground group-hover:text-coral transition-colors" strokeWidth={1.75} />
                {cartCount > 0 && (
                  <span className="absolute -top-2 -right-2 bg-coral text-coral-foreground text-[14px] font-bold min-w-[20px] h-[20px] px-1 flex items-center justify-center rounded-full shadow-sm leading-none">
                    {cartCount}
                  </span>
                )}
              </div>
              <span className="text-[17px] font-semibold">Cart</span>
            </Link>
          </nav>
        </div>
      </header>

      {/* Mobile Header (hidden on desktop) */}
      <div data-top-navigation className="md:hidden flex flex-col border-b border-border bg-card sticky top-0 z-50 shadow-sm">
        <header className="flex items-center justify-between h-[56px] px-4">
          <Link href="/" aria-label="HDS Home" data-testid="link-logo-home" className="font-brand text-xl font-bold tracking-tight text-coral">
            HDS
          </Link>
          <div className="flex items-center gap-1">
            <Link href="/cart" className="relative p-2 min-h-[44px] min-w-[44px] flex items-center justify-center" aria-label="Cart" title="Cart">
              <div className="relative">
                <ShoppingCart className="w-6 h-6 text-muted-foreground" strokeWidth={1.75} />
                {cartCount > 0 && (
                  <span className="absolute -top-2 -right-2 bg-coral text-coral-foreground text-[14px] font-bold min-w-[20px] h-[20px] px-1 flex items-center justify-center rounded-full leading-none">
                    {cartCount}
                  </span>
                )}
              </div>
            </Link>
          </div>
        </header>
        {onDiscover && (
          <div className="px-4 pb-1 flex items-center justify-between gap-3">
            {contextLabel}
            <Link href="/" data-testid="link-home" className="shrink-0 min-h-[44px] -my-2 px-2 inline-flex items-center text-role-small text-muted-foreground hover:text-foreground">Home</Link>
          </div>
        )}
      </div>

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
