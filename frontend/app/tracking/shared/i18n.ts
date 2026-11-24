'use client';
import { createContext, useContext } from 'react';

export type Lang = 'th' | 'en';
export type Theme = 'light' | 'dark' | 'system';
/** The surface colours used in dark mode (tracking.css). Light mode has one palette. */
export type DarkPalette = 'slate' | 'graphite' | 'warm' | 'navy' | 'ocean' | 'forest' | 'plum';
export const DARK_PALETTES: readonly DarkPalette[] = ['slate', 'graphite', 'warm', 'navy', 'ocean', 'forest', 'plum'];

export type TrackingCtx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  /** theme with 'system' resolved. */
  resolvedTheme: 'light' | 'dark';
  darkPalette: DarkPalette;
  setDarkPalette: (p: DarkPalette) => void;
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
  const { theme, setTheme, resolvedTheme, darkPalette, setDarkPalette } = useCtx();
  return { theme, setTheme, resolvedTheme, darkPalette, setDarkPalette };
}

/** Every component keeps its own TEXT = { th, en }; user content is never translated. */
export function useT<T>(TEXT: { th: T; en: T }): T {
  return TEXT[useCtx().lang];
}
