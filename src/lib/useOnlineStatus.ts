import { useEffect, useState } from 'react';

/**
 * TanStack Query already pauses queries while offline and resumes them on reconnect
 * (default `networkMode: 'online'`, driven by the same online/offline events) — this hook is
 * for surfacing that state to the user, and for gating the bulk/detail writes that go through
 * raw `fetch` rather than useQuery/useMutation.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return online;
}
