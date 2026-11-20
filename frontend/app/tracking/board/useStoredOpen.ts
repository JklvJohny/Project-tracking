'use client';
import { useCallback, useEffect, useState } from 'react';

/**
 * Open/closed state of a collapsible section, remembered per viewer in localStorage ('1' / '0').
 * Starts at `initial` so the server render and first paint match; the saved choice applies right after mount.
 * Storage failures are ignored: the choice then lasts for this visit only.
 */
export function useStoredOpen(key: string, initial: boolean): [boolean, (open: boolean) => void] {
  const [open, setOpenState] = useState(initial);
  useEffect(() => {
    try {
      const v = localStorage.getItem(key);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- storage is only readable after mount
      if (v === '1' || v === '0') setOpenState(v === '1');
    } catch {
      /* storage unavailable: keep the initial state */
    }
  }, [key]);
  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next);
      try {
        localStorage.setItem(key, next ? '1' : '0');
      } catch {
        /* storage unavailable */
      }
    },
    [key],
  );
  return [open, setOpen];
}
