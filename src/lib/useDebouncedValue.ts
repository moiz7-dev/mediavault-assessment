import { useEffect, useState } from 'react';

/**
 * Debounces a value by `delayMs` of silence.
 *
 * 400ms: short enough that a deliberate pause reads as "done typing", long enough that
 * ordinary typing (keystrokes land well under 400ms apart) never fires a request per
 * character. It also means a fast typist finishing a word never triggers the API's
 * slowest path — short `q` prefixes (1-2 chars) carry an extra ~700ms of latency — since
 * the debounce swallows those transient short values before they're ever sent.
 */
export function useDebouncedValue<T>(value: T, delayMs = 400): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
