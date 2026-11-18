'use client';
import Link from 'next/link';
import { Skeleton } from '@/components/ui/skeleton';
import { useT } from '../shared/i18n';
import { routes } from '../shared/routes';
import { StatusPill } from '../shared/StatusPill';
import { Members, Owner, Progress, Timeline } from './project-parts';
import type { ProjectRow } from './project-row';

const TEXT = {
  th: { name: 'โปรเจกต์', owner: 'เจ้าของ', status: 'สถานะ', dates: 'ช่วงเวลา', members: 'สมาชิก', progress: 'ความคืบหน้า', loading: 'กำลังโหลด' },
  en: { name: 'Project', owner: 'Owner', status: 'Status', dates: 'Timeline', members: 'Members', progress: 'Progress', loading: 'Loading' },
};

const TH = 'px-4 py-2 font-medium whitespace-nowrap';
const TD = 'px-4 py-3 align-middle';

// Scrolls inside its own container on narrow screens; the page itself never scrolls sideways.
export function ProjectsTable({ projects }: { projects: ProjectRow[] }) {
  const t = useT(TEXT);
  return (
    <div className="relative overflow-x-auto rounded-lg border bg-card">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th scope="col" className={TH}>{t.name}</th>
            <th scope="col" className={TH}>{t.owner}</th>
            <th scope="col" className={TH}>{t.status}</th>
            <th scope="col" className={TH}>{t.dates}</th>
            <th scope="col" className={TH}>{t.members}</th>
            <th scope="col" className={TH}>{t.progress}</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr key={p.id} className="border-b last:border-0 hover:bg-accent/50">
              <td className={`${TD} min-w-48 max-w-72`}>
                <Link href={routes.board(p.id)} className="font-medium hover:underline">
                  {p.name}
                </Link>
                {p.description && <p className="truncate text-xs text-muted-foreground">{p.description}</p>}
              </td>
              <td className={`${TD} whitespace-nowrap`}><Owner p={p} /></td>
              <td className={TD}><StatusPill status={p.archivedAt ? 'archived' : p.status} /></td>
              <td className={`${TD} whitespace-nowrap text-muted-foreground`}><Timeline p={p} /></td>
              <td className={TD}><Members p={p} /></td>
              <td className={`${TD} whitespace-nowrap`}><Progress p={p} /></td>
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
