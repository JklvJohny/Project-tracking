'use client';
import { createContext, useContext } from 'react';

export type Lang = 'th' | 'en';
export type Theme = 'light' | 'dark' | 'system';

export type TrackingCtx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  /** theme with 'system' resolved. */
  resolvedTheme: 'light' | 'dark';
};

export const TrackingContext = createContext<TrackingCtx | null>(null);

function useCtx(): TrackingCtx {
  const c = useContext(TrackingContext);
  if (!c) throw new Error('TrackingProvider missing');
  return c;
}

export function useLang(): { lang: Lang; setLang: (l: Lang) => void } {
  const { lang, setLang } = useCtx();
  return { lang, setLang };
}

export function useTheme() {
  const { theme, setTheme, resolvedTheme } = useCtx();
  return { theme, setTheme, resolvedTheme };
}

/** Every component keeps its own TEXT = { th, en }; user content is never translated. */
export function useT<T>(TEXT: { th: T; en: T }): T {
  return TEXT[useCtx().lang];
}
