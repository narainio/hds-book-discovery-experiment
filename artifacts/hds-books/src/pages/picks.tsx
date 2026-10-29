import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { focusYourFilter } from '@/hooks/use-your-filter';

/**
 * The legacy multi-book Filter page is retired in this experiment. Old links
 * land on /discover with Your Filter focused (single example + direction).
 */
export default function Picks() {
  const [, setLoc] = useLocation();
  useEffect(() => {
    setLoc('/discover', { replace: true });
    focusYourFilter();
  }, [setLoc]);
  return <p className="p-8 text-role-body text-muted-foreground">Opening the Filter…</p>;
}
