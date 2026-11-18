'use client';
// Local-only stand-in for the host app's sidebar, header and login. Never copied to the host.
import { useQueryClient } from '@tanstack/react-query';
import { BarChart3, FileText, FolderOpen, Moon, Settings, Sun, Upload, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Avatar } from '../tracking/shared/Avatar';
import { useLang, useT, useTheme } from '../tracking/shared/i18n';
import { TrackingProvider } from '../tracking/shared/provider';
import { routes } from '../tracking/shared/routes';

const DEV_USER_KEY = 'pt-dev-user';
const DEV_MODE_KEY = 'pt-dev-mode';
const SHOW_USERS = process.env.NEXT_PUBLIC_ENV === 'local';

// Dev tools stay hidden so screens look like the host app; Ctrl+Shift+B shows them, Ctrl+Alt+Shift+B hides them.
// Matched on `code`, so the shortcut works with the Thai keyboard layout too.
function devModeShortcut(e: KeyboardEvent): boolean | null {
  if (!e.ctrlKey || !e.shiftKey || e.metaKey || e.code !== 'KeyB') return null;
  return !e.altKey;
}

function readDevMode(): boolean {
  try {
    return localStorage.getItem(DEV_MODE_KEY) === '1';
  } catch {
    return false;
  }
}

function saveDevMode(on: boolean) {
  try {
    localStorage.setItem(DEV_MODE_KEY, on ? '1' : '0');
  } catch {
    /* storage blocked: the mode lasts only until reload */
  }
}

// From backend/README.md (dev users). Roles are the system role; project roles vary per project.
const DEV_USERS = [
  { id: 1, name: 'สมชาย ใจดี', role: 'admin' },
  { id: 2, name: 'Napat K.', role: 'manager' },
  { id: 3, name: 'วิภา รักงาน', role: 'member' },
  { id: 4, name: 'Somsak P.', role: 'member' },
  { id: 5, name: 'ปิยะ มั่นคง', role: 'member' },
  { id: 6, name: 'Mali S.', role: 'viewer' },
  { id: 7, name: 'ธนากร ทองดี', role: 'member' },
  { id: 8, name: 'Anan T.', role: 'no role' },
];

const TEXT = {
  th: {
    nav: 'เมนูหลัก', app: 'แอปหลัก', section: 'ติดตามงาน', other: 'อื่นๆ', dashboard: 'แดชบอร์ด', projects: 'โปรเจกต์',
    import: 'นำเข้า', reports: 'รายงาน', settings: 'ตั้งค่า', soon: 'เร็ว ๆ นี้', lang: 'ภาษา', theme: 'สลับธีม',
    user: 'ผู้ใช้ (dev)', mobileNav: 'ไปที่',
  },
  en: {
    nav: 'Main menu', app: 'Host App', section: 'Tracking', other: 'Other', dashboard: 'Dashboard', projects: 'Projects',
    import: 'Import', reports: 'Reports', settings: 'Settings', soon: 'Soon', lang: 'Language', theme: 'Toggle theme',
    user: 'User (dev)', mobileNav: 'Go to',
  },
};

type NavItem = { key: 'dashboard' | 'projects' | 'import' | 'reports' | 'settings'; icon: LucideIcon; href?: string };
const TRACKING_NAV: NavItem[] = [
  { key: 'dashboard', icon: BarChart3 },
  { key: 'projects', icon: FolderOpen, href: routes.projects },
  { key: 'import', icon: Upload },
  { key: 'reports', icon: FileText, href: routes.reports },
];
const OTHER_NAV: NavItem[] = [{ key: 'settings', icon: Settings }];

function readDevUser(): string {
  try {
    return sessionStorage.getItem(DEV_USER_KEY) ?? '2';
  } catch {
    return '2';
  }
}

// Read at call time so a user switch applies to the very next request.
const getAuthHeaders = (): Record<string, string> => (SHOW_USERS ? { 'X-User-ID': readDevUser() } : {});

export function DevShell({ children }: { children: ReactNode }) {
  return (
    <TrackingProvider getAuthHeaders={getAuthHeaders}>
      <Chrome>{children}</Chrome>
    </TrackingProvider>
  );
}

function Chrome({ children }: { children: ReactNode }) {
  const t = useT(TEXT);
  const { lang, setLang } = useLang();
  const { setTheme, resolvedTheme } = useTheme();
  const qc = useQueryClient();
  const [userId, setUserId] = useState('2');
  const [devMode, setDevMode] = useState(false);

  // Storage is not available during SSR; sync after mount.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUserId(readDevUser());
    setDevMode(readDevMode());
  }, []);

  useEffect(() => {
    // A non-local build has no dev tools to show, so the shortcut does nothing there.
    if (!SHOW_USERS) return;
    const onKey = (e: KeyboardEvent) => {
      const on = devModeShortcut(e);
      if (on === null) return;
      // Chrome binds Ctrl+Shift+B to the bookmarks bar.
      e.preventDefault();
      saveDevMode(on);
      setDevMode(on);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const pickUser = (id: string) => {
    try {
      sessionStorage.setItem(DEV_USER_KEY, id);
    } catch {
      /* storage blocked: the switch lasts only until reload */
    }
    setUserId(id);
    // Another user sees other data: drop everything cached for the previous one.
    qc.clear();
  };

  const path = usePathname() ?? '';
  const onReports = path === routes.reports || path.startsWith(`${routes.reports}/`);
  const me = DEV_USERS.find((u) => String(u.id) === userId) ?? DEV_USERS[1];
  const dark = resolvedTheme === 'dark';

  const navItem = ({ key, icon: Icon, href }: NavItem) => {
    const base = 'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm';
    if (!href)
      return (
        <span key={key} aria-disabled="true" className={`${base} cursor-not-allowed text-muted-foreground opacity-60`}>
          <Icon className="h-4 w-4" aria-hidden="true" />
          {t[key]}
          {key !== 'settings' && <span className="ml-auto rounded-full bg-muted px-1.5 py-0.5 text-[10px]">{t.soon}</span>}
        </span>
      );
    const current = key === 'reports' ? onReports : path.startsWith(routes.projects) && !onReports;
    return (
      <Link
        key={key}
        href={href}
        aria-current={current ? 'page' : undefined}
        className={`${base} ${current ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent'}`}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
        {t[key]}
      </Link>
    );
  };
  const heading = 'px-2.5 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground';

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b bg-card px-4 py-2 text-xs">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <span aria-hidden="true" className="h-6 w-6 rounded-md bg-primary" />
          {t.app}
        </span>
        <Link href={routes.projects} className="rounded px-2 py-1 font-medium hover:bg-accent sm:hidden">
          {t.projects}
        </Link>
        <div className="ml-auto flex items-center gap-3">
          {SHOW_USERS && devMode && (
            <label className="flex items-center gap-1.5">
              {t.user}
              <select
                value={userId}
                onChange={(e) => pickUser(e.target.value)}
                className="rounded border bg-background px-1.5 py-1"
              >
                {DEV_USERS.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.id} {u.name} ({u.role})
                  </option>
                ))}
              </select>
            </label>
          )}
          <div role="group" aria-label={t.lang} className="flex rounded-full border bg-muted p-0.5">
            {(['en', 'th'] as const).map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={lang === l}
                onClick={() => setLang(l)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${lang === l ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'}`}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-label={t.theme}
            onClick={() => setTheme(dark ? 'light' : 'dark')}
            className="rounded-full p-1.5 text-muted-foreground hover:bg-accent"
          >
            {dark ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
          </button>
          <Avatar user={me} size="md" />
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="w-52 shrink-0 border-r bg-card p-3 text-sm max-sm:hidden" aria-label={t.nav}>
          <nav className="flex flex-col gap-0.5">
            <p className={heading}>{t.section}</p>
            {TRACKING_NAV.map(navItem)}
            <p className={heading}>{t.other}</p>
            {OTHER_NAV.map(navItem)}
          </nav>
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
