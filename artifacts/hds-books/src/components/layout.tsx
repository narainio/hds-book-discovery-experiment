import React, { useEffect, useRef } from 'react';
import { Link, useLocation } from 'wouter';
import { Funnel, ShoppingCart, ChevronDown } from 'lucide-react';
import { useSession } from '@/hooks/use-session';
import { useYourFilter, focusYourFilter } from '@/hooks/use-your-filter';
import { YourFilter } from '@/components/your-filter';
import { filterKind } from '@/lib/filter-controller';
import { useListModes } from '@workspace/api-client-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';

export default function Layout({ children }: { children: React.ReactNode }) {
  const { session, isLoading } = useSession();
  const { data: modes } = useListModes();
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

  const { view } = useYourFilter();
  const kind = filterKind(view?.filter ?? null);
  const picksCount = kind === 'both' ? 2 : kind === 'empty' ? 0 : 1;
  const cartCount = session?.cartCount || 0;
  const activeModeLabel = session?.modeLabel || 'Book for Johnny (age 10)';

  const renderModeMenu = () => {
    if (!modes) return null;
    return (
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className="flex items-center gap-1.5 text-[18px] text-foreground hover:text-teal transition-colors font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
            {loc === '/' ? <span className="md:hidden">Shopping for {activeModeLabel}</span> : null}
            <span className={loc === '/' ? "hidden md:inline" : ""}>{activeModeLabel}</span>
            <ChevronDown className="w-5 h-5 text-muted-foreground" strokeWidth={2} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="start" className="bg-card border border-border rounded-lg shadow-lg p-2 min-w-[240px] z-50">
            {modes.map(mode => (
              <DropdownMenu.Item
                key={mode.id}
                disabled={!mode.available}
                className="flex items-center justify-between px-3 py-2.5 text-sm rounded-md outline-none select-none data-[disabled]:opacity-50 data-[highlighted]:bg-secondary/50 data-[disabled]:data-[highlighted]:bg-transparent"
              >
                <span className={`font-medium ${mode.available ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {mode.label}
                </span>
                {!mode.available && mode.note && (
                  <span className="text-role-small text-muted-foreground shrink-0 ml-4">{mode.note}</span>
                )}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    );
  };

  return (
    <div ref={layoutRef} className="min-h-[100dvh] flex flex-col bg-background">
      {/* Desktop Header (hidden on mobile) */}
      <header data-top-navigation className="hidden md:flex items-center h-[72px] px-6 lg:px-8 border-b border-border bg-card sticky top-0 z-50 shadow-sm">
        <div className="flex-1 flex items-center max-w-[1440px] mx-auto w-full">
          <Link href="/" className="font-brand text-2xl font-bold tracking-tight text-coral mr-8">
            HDS
          </Link>
          
          {renderModeMenu()}
          
          <div className="flex-1" />
          
          <nav className="flex items-center gap-2">
            <Link href="/#your-filter" onClick={focusYourFilter} data-testid="link-your-filter" className="flex items-center gap-2 text-foreground hover:text-teal transition-colors group p-2 min-h-[44px] min-w-[44px] justify-center">
              <div className="relative">
                <Funnel className="w-6 h-6 text-muted-foreground group-hover:text-teal transition-colors" strokeWidth={1.75} />
                {picksCount > 0 && (
                  <span className="absolute -top-2 -right-2 bg-teal text-teal-foreground text-[14px] font-bold min-w-[20px] h-[20px] px-1 flex items-center justify-center rounded-full shadow-sm leading-none">
                    {picksCount}
                  </span>
                )}
              </div>
              <span className="text-[17px] font-semibold">Your Filter</span>
            </Link>
            
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
          <Link href="/" className="font-brand text-xl font-bold tracking-tight text-coral">
            HDS
          </Link>
          <div className="flex items-center gap-1">
            <Link href="/#your-filter" onClick={focusYourFilter} data-testid="link-your-filter-mobile" className="flex items-center gap-1.5 px-2 min-h-[44px] rounded-md text-foreground" aria-label={`Jump to Your Filter, ${picksCount} input${picksCount === 1 ? '' : 's'}`}>
              <Funnel className="w-5 h-5 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
              <span className="text-role-ui">Your Filter</span>
              {picksCount > 0 && (
                <span className="bg-teal text-teal-foreground text-[14px] font-bold min-w-[20px] h-[20px] px-1 flex items-center justify-center rounded-full leading-none" aria-hidden="true">
                  {picksCount}
                </span>
              )}
            </Link>
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
        {loc === '/' && (
          <div className="px-4 pb-3">
            {renderModeMenu()}
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
            {loc.startsWith('/book/') && (
              <div className="px-4 md:px-8 pt-4 max-w-3xl">
                <YourFilter variant="compact" />
              </div>
            )}
            {children}
          </>
        )}
      </main>
    </div>
  );
}
