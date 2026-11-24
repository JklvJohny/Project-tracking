'use client';
import { useEffect, useState } from 'react';
import { api } from './api/client';
import type { components } from './api/schema';

type User = components['schemas']['User'];
const DEBOUNCE_MS = 250;

/** Debounced people search. A cleanup flag drops any response that is no longer the latest request. */
export function useUserSearch(q: string) {
  const [state, setState] = useState<{ q: string; users: User[] } | null>(null);
  useEffect(() => {
    const term = q.trim();
    if (!term) return;
    const ctl = new AbortController();
    let stale = false;
    const timer = setTimeout(() => {
      api<User[]>(`/users?q=${encodeURIComponent(term)}`, { signal: ctl.signal })
        .then((users) => !stale && setState({ q: term, users }))
        .catch(() => !stale && setState({ q: term, users: [] }));
    }, DEBOUNCE_MS);
    return () => {
      stale = true;
      ctl.abort();
      clearTimeout(timer);
    };
  }, [q]);
  // Results of an older term are never shown for the current one.
  return q.trim() && state?.q === q.trim() ? state.users : null;
}
