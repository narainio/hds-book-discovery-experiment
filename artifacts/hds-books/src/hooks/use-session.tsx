import React, { createContext, useContext, useEffect, useState } from 'react';
import { useCreateSession, useGetSession, getGetSessionQueryKey } from '@workspace/api-client-react';
import type { SessionState } from '@workspace/api-client-react';

// Isolated namespace for the product-as-filter experiment fork.
const SESSION_KEY = 'hds_pf_experiment_session_id';

interface SessionContextValue {
  sessionId: string | null;
  session: SessionState | null;
  isLoading: boolean;
}

const SessionContext = createContext<SessionContextValue>({
  sessionId: null,
  session: null,
  isLoading: true,
});

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);

  const createSession = useCreateSession();

  useEffect(() => {
    const storedId = localStorage.getItem(SESSION_KEY);
    if (storedId) {
      setSessionId(storedId);
      setIsInitializing(false);
    } else {
      createSession.mutate(undefined, {
        onSuccess: (data) => {
          localStorage.setItem(SESSION_KEY, data.sessionId);
          setSessionId(data.sessionId);
          setIsInitializing(false);
        },
        onError: () => {
          setIsInitializing(false);
        }
      });
    }
  }, []);

  const { data: session, isLoading: isSessionLoading } = useGetSession(
    sessionId || '',
    {
      query: {
        enabled: !!sessionId,
        queryKey: getGetSessionQueryKey(sessionId || '')
      }
    }
  );

  const isLoading = isInitializing || (!!sessionId && isSessionLoading);

  return (
    <SessionContext.Provider value={{ sessionId, session: session || null, isLoading }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  return useContext(SessionContext);
}
