'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, configureApi } from './api/client';
import { ConfirmProvider } from './confirm';
import { DARK_PALETTES, TrackingContext, type DarkPalette, type Lang, type Theme, type TrackingCtx } from './i18n';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';

const LANG_KEY = 'pt-lang';
const THEME_KEY = 'pt-theme';
const DARK_KEY = 'pt-dark-palette';

function readStored<T extends string>(key: string, allowed: readonly T[]): T | undefined {
  try {
    const v = localStorage.getItem(key);
    return allowed.includes(v as T) ? (v as T) : undefined;
  } catch {
    return undefined;
  }
}
function writeStored(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* private mode / blocked storage: the choice just is not remembered */
  }
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        refetchOnWindowFocus: false,
        // 4xx will not fix itself; only retry transient failures once.
        retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 1,
      },
    },
  });
}

export type TrackingProviderProps = {
  /** Controlled language. Omit to use the provider's own store (localStorage `pt-lang`). */
  lang?: Lang;
  /** Controlled theme. Omit to use the provider's own store (localStorage `pt-theme`). */
  theme?: Theme;
  /** Controlled dark-mode palette. Omit to use the provider's own store (localStorage `pt-dark-palette`). */
  darkPalette?: DarkPalette;
  /** Extra headers for every API call (the host's auth; the dev shell's X-User-ID). */
  getAuthHeaders?: () => Record<string, string> | Promise<Record<string, string>>;
  children: ReactNode;
};

// A provider inside another one is a no-op, so the dev shell can own the context
// while app/tracking/layout.tsx (which ships to the host) still mounts its own.
export function TrackingProvider(props: TrackingProviderProps) {
  const parent = useContext(TrackingContext);
  if (parent) return <>{props.children}</>;
  return <Root {...props} />;
}

function Root({ lang: langProp, theme: themeProp, darkPalette: paletteProp, getAuthHeaders, children }: TrackingProviderProps) {
  const [langState, setLangState] = useState<Lang>('th');
  const [themeState, setThemeState] = useState<Theme>('system');
  const [paletteState, setPaletteState] = useState<DarkPalette>('slate');
  const [systemDark, setSystemDark] = useState(false);
  const [queryClient] = useState(makeQueryClient);

  // Stored values are read after mount so server and first client render agree.
  /* eslint-disable react-hooks/set-state-in-effect -- one-time post-mount read, avoids a hydration mismatch */
  useEffect(() => {
    setLangState(readStored(LANG_KEY, ['th', 'en'] as const) ?? 'th');
    setThemeState(readStored(THEME_KEY, ['light', 'dark', 'system'] as const) ?? 'system');
    setPaletteState(readStored(DARK_KEY, DARK_PALETTES) ?? 'slate');
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const sync = () => setSystemDark(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const lang = langProp ?? langState;
  const theme = themeProp ?? themeState;
  const resolvedTheme = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
  const darkPalette = paletteProp ?? paletteState;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolvedTheme === 'dark');
    // Native controls and the page scrollbar follow the theme (no white scrollbar track in dark mode).
    document.documentElement.style.colorScheme = resolvedTheme;
    document.documentElement.lang = lang;
    // Only takes effect under .dark (tracking.css), so it is set whatever the theme.
    document.documentElement.dataset.ptDark = darkPalette;
  }, [resolvedTheme, lang, darkPalette]);

  // Set during render, not in an effect: child effects (first queries) run before parent effects.
  configureApi({ getAuthHeaders });

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    writeStored(LANG_KEY, l);
  }, []);
  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    writeStored(THEME_KEY, t);
  }, []);
  const setDarkPalette = useCallback((p: DarkPalette) => {
    setPaletteState(p);
    writeStored(DARK_KEY, p);
  }, []);

  const ctx = useMemo<TrackingCtx>(
    () => ({ lang, setLang, theme, setTheme, resolvedTheme, darkPalette, setDarkPalette }),
    [lang, setLang, theme, setTheme, resolvedTheme, darkPalette, setDarkPalette],
  );

  return (
    <TrackingContext.Provider value={ctx}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <ConfirmProvider>
            {children}
            <Toaster theme={resolvedTheme} />
          </ConfirmProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </TrackingContext.Provider>
  );
}
