'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../shared/api/client';
import { errorMessage, errorText } from '../shared/errors';
import { useLang, useT, type Lang } from '../shared/i18n';

const TEXT = { th: { saved: 'บันทึกแล้ว' }, en: { saved: 'Saved' } };

type State = { kind: 'idle' | 'saving' | 'saved' } | { kind: 'error'; message: string };

/** A field error code (before_start, too_long, ...) beats the generic envelope text when the server sent one. */
function saveError(e: unknown, lang: Lang): string {
  if (e instanceof ApiError && e.fields) {
    const code = Object.values(e.fields)[0];
    if (code) return errorText(code, lang);
  }
  return errorMessage(e, lang);
}

/** Save state of one inline-edited field: quiet "Saved" for 2s, inline error text, never a toast. */
export function useInlineSave<I>(mutateAsync: (input: I) => Promise<unknown>) {
  const { lang } = useLang();
  const [state, setState] = useState<State>({ kind: 'idle' });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const save = useCallback(
    async (input: I): Promise<boolean> => {
      clearTimeout(timer.current);
      setState({ kind: 'saving' });
      try {
        await mutateAsync(input);
        setState({ kind: 'saved' });
        timer.current = setTimeout(() => setState({ kind: 'idle' }), 2000);
        return true;
      } catch (e) {
        setState({ kind: 'error', message: saveError(e, lang) });
        return false;
      }
    },
    [mutateAsync, lang],
  );
  const fail = useCallback((message: string) => setState({ kind: 'error', message }), []);
  const clear = useCallback(() => setState((s) => (s.kind === 'error' ? { kind: 'idle' } : s)), []);
  return { state, save, fail, clear };
}

/** The live region is always mounted so assistive tech announces the change when text appears. */
export function SaveStatus({ state, id }: { state: State; id?: string }) {
  const t = useT(TEXT);
  const text = state.kind === 'saved' ? t.saved : state.kind === 'error' ? state.message : '';
  return (
    <span
      id={id}
      aria-live="polite"
      className={`min-h-4 text-xs ${state.kind === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}
    >
      {text}
    </span>
  );
}

/**
 * Runs `flush` once when the field unmounts (panel closed by Escape, overlay, Back). React fires no blur on removal,
 * so without this a half-typed edit would be lost. The latest closure is kept in a ref, so it sees the final draft.
 */
export function useFlushOnUnmount(flush: () => void) {
  const ref = useRef(flush);
  useEffect(() => {
    ref.current = flush;
  });
  useEffect(() => () => ref.current(), []);
}

/** Escape in a dirty inline field only cancels that field (it resets itself); the next Escape closes the layer. */
export function inlineEscape(e: KeyboardEvent) {
  if ((e.target as HTMLElement | null)?.closest?.('[data-inline-edit][data-dirty="true"]')) e.preventDefault();
}
