'use client';
// Local-only stand-in for the host app's sidebar, header and login. Never copied to the host.
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { useLang, useT, useTheme, type Theme } from '../tracking/shared/i18n';
import { TrackingProvider } from '../tracking/shared/provider';
import { routes } from '../tracking/shared/routes';

const DEV_USER_KEY = 'pt-dev-user';
const SHOW_USERS = process.env.NEXT_PUBLIC_ENV === 'local';

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
  th: { nav: 'เมนูหลัก', projects: 'โปรเจกต์', lang: 'ภาษา', theme: 'ธีม', user: 'ผู้ใช้ (dev)', light: 'สว่าง', dark: 'มืด', system: 'ตามระบบ' },
  en: { nav: 'Main menu', projects: 'Projects', lang: 'Language', theme: 'Theme', user: 'User (dev)', light: 'Light', dark: 'Dark', system: 'System' },
};

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
  const { theme, setTheme } = useTheme();
  const qc = useQueryClient();
  const [userId, setUserId] = useState('2');

  // sessionStorage is not available during SSR; sync after mount.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setUserId(readDevUser()), []);

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

  return (
    <div className="flex min-h-screen">
      <aside className="w-48 shrink-0 border-r bg-muted/40 p-3 text-sm max-sm:hidden" aria-label={t.nav}>
        <nav className="flex flex-col gap-1">
          <Link href={routes.projects} className="rounded px-2 py-1.5 font-medium hover:bg-accent">
            {t.projects}
          </Link>
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-end gap-3 border-b px-4 py-2 text-xs">
          <Link href={routes.projects} className="mr-auto rounded px-2 py-1 font-medium hover:bg-accent sm:hidden">
            {t.projects}
          </Link>
          {SHOW_USERS && (
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
          <label className="flex items-center gap-1.5">
            {t.lang}
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value as 'th' | 'en')}
              className="rounded border bg-background px-1.5 py-1"
            >
              <option value="th">TH</option>
              <option value="en">EN</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            {t.theme}
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value as Theme)}
              className="rounded border bg-background px-1.5 py-1"
            >
              <option value="light">{t.light}</option>
              <option value="dark">{t.dark}</option>
              <option value="system">{t.system}</option>
            </select>
          </label>
        </header>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
