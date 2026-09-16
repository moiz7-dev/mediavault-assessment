import { useCallback, useEffect, useState } from 'react';

function readParams<T extends Record<string, string>>(defaults: T): T {
  const params = new URLSearchParams(window.location.search);
  const next = { ...defaults };
  for (const key of Object.keys(defaults) as Array<keyof T>) {
    const value = params.get(key as string);
    if (value !== null) next[key] = value as T[keyof T];
  }
  return next;
}

function writeParams<T extends Record<string, string>>(defaults: T, state: T): void {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(state)) {
    if (value && value !== defaults[key]) params.set(key, value);
  }
  const qs = params.toString();
  const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.replaceState(null, '', url);
}

/**
 * Query state that lives in the URL: reload or share the link, get the same view back.
 * Always uses replaceState — filter and search changes are frequent and transient enough
 * that one history entry per change would make the back button useless for real navigation.
 */
export function useUrlState<T extends Record<string, string>>(defaults: T): [T, (patch: Partial<T>) => void] {
  const [state, setState] = useState<T>(() => readParams(defaults));

  useEffect(() => {
    const onPopState = () => setState(readParams(defaults));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = useCallback((patch: Partial<T>) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      writeParams(defaults, next);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return [state, update];
}
