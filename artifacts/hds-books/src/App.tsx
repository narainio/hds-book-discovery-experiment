import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import Discover from '@/pages/discover';
import Home from '@/pages/home';
import ProductDetail from '@/pages/product-detail';
import Picks from '@/pages/picks';
import Cart from '@/pages/cart';
import Checkout from '@/pages/checkout';
import Layout from '@/components/layout';
import { SessionProvider } from '@/hooks/use-session';
import { YourFilterProvider } from '@/hooks/use-your-filter';
import { WorkingContextProvider } from '@/hooks/use-working-context';

import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();

function Router() {
  return (
    <Layout>
      <RoutedErrorBoundary>
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/discover" component={Discover} />
          <Route path="/book/:id" component={ProductDetail} />
          <Route path="/picks" component={Picks} />
          <Route path="/cart" component={Cart} />
          <Route path="/checkout" component={Checkout} />
          <Route component={NotFound} />
        </Switch>
      </RoutedErrorBoundary>
    </Layout>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <SessionProvider>
          <YourFilterProvider>
            <WorkingContextProvider>
              <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
                <Router />
              </WouterRouter>
            </WorkingContextProvider>
          </YourFilterProvider>
          <Toaster />
        </SessionProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
