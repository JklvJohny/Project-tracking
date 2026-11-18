'use client';
import Link from 'next/link';
import { Skeleton } from '@/components/ui/skeleton';
import type { components } from '../shared/api/schema';
import { fmtDate } from '../shared/format';
import { useLang, useT } from '../shared/i18n';
import { routes } from '../shared/routes';
import { StatusPill } from '../shared/StatusPill';

type Project = components['schemas']['Project'];

const TEXT = {
  th: { name: 'ชื่อโปรเจกต์', status: 'สถานะ', dates: 'ช่วงเวลา', loading: 'กำลังโหลด' },
  en: { name: 'Project', status: 'Status', dates: 'Dates', loading: 'Loading' },
};

export function ProjectsTable({ projects }: { projects: Project[] }) {
  const t = useT(TEXT);
  const { lang } = useLang();
  const range = (p: Project) =>
    p.startDate || p.endDate
      ? `${p.startDate ? fmtDate(p.startDate, lang) : '–'} – ${p.endDate ? fmtDate(p.endDate, lang) : '–'}`
      : '–';
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full text-sm">
        <thead className="border-b text-left text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-2 font-medium">{t.name}</th>
            <th scope="col" className="px-4 py-2 font-medium">{t.status}</th>
            <th scope="col" className="px-4 py-2 font-medium">{t.dates}</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr key={p.id} className="border-b last:border-0 hover:bg-accent/50">
              <td className="px-4 py-3">
                <Link href={routes.board(p.id)} className="font-medium hover:underline">
                  {p.name}
                </Link>
              </td>
              <td className="px-4 py-3">
                <StatusPill status={p.archivedAt ? 'archived' : p.status} />
              </td>
              <td className="px-4 py-3 text-muted-foreground tabular-nums">{range(p)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ProjectsTableSkeleton() {
  const t = useT(TEXT);
  return (
    <div role="status" aria-label={t.loading} className="space-y-2 rounded-lg border bg-card p-4">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  );
}
