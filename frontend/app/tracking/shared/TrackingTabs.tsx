'use client';
import { BarChart3, FileText, FolderOpen, Upload, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useT } from './i18n';
import { routes } from './routes';

const TEXT = {
  th: { nav: 'เมนูติดตามงาน', dashboard: 'แดชบอร์ด', projects: 'โปรเจกต์', reports: 'รายงาน', import: 'นำเข้า', soon: 'เร็วๆ นี้' },
  en: { nav: 'Tracking', dashboard: 'Dashboard', projects: 'Projects', reports: 'Reports', import: 'Import', soon: 'Soon' },
};

type Key = 'dashboard' | 'projects' | 'import' | 'reports';
const TABS: { key: Key; icon: LucideIcon; href?: string }[] = [
  { key: 'dashboard', icon: BarChart3 },
  { key: 'projects', icon: FolderOpen, href: routes.projects },
  { key: 'import', icon: Upload },
  { key: 'reports', icon: FileText, href: routes.reports },
];

const BASE = 'inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium';

// Ships to the host. Dashboard and Import are placeholders until those pages exist.
export function TrackingTabs() {
  const t = useT(TEXT);
  const path = usePathname() ?? '';
  const onReports = path === routes.reports || path.startsWith(`${routes.reports}/`);
  return (
    <nav aria-label={t.nav} className="flex gap-1 overflow-x-auto border-b bg-card px-4 sm:px-6">
      {TABS.map(({ key, icon: Icon, href }) => {
        if (!href)
          return (
            <span key={key} aria-disabled="true" className={`${BASE} cursor-not-allowed border-transparent text-muted-foreground opacity-60`}>
              <Icon className="h-4 w-4" aria-hidden="true" />
              {t[key]}
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium">{t.soon}</span>
            </span>
          );
        const current = key === 'reports' ? onReports : !onReports;
        return (
          <Link
            key={key}
            href={href}
            aria-current={current ? 'page' : undefined}
            className={`${BASE} ${current ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {t[key]}
          </Link>
        );
      })}
    </nav>
  );
}
