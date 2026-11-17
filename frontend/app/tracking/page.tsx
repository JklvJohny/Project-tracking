'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useMe, useProjects } from './shared/api/queries';
import { errorMessage } from './shared/errors';
import { useLang, useT } from './shared/i18n';
import { routes } from './shared/routes';
import { CreateProjectDialog } from './projects/CreateProjectDialog';
import { ProjectsTable, ProjectsTableSkeleton } from './projects/ProjectsTable';

const TEXT = {
  th: {
    title: 'โปรเจกต์',
    count: (n: number) => `${n} โปรเจกต์`,
    create: 'โปรเจกต์ใหม่',
    filter: 'กรองตามสถานะ',
    all: 'ทั้งหมด',
    active: 'กำลังดำเนินการ',
    on_hold: 'พักไว้',
    done: 'เสร็จสิ้น',
    archived: 'เก็บถาวร',
    empty: 'ยังไม่มีโปรเจกต์',
    emptyHint: 'สร้างโปรเจกต์แรกเพื่อเริ่มต้น',
    emptyFiltered: 'ไม่มีโปรเจกต์ในสถานะนี้',
    retry: 'ลองอีกครั้ง',
  },
  en: {
    title: 'Projects',
    count: (n: number) => `${n} project${n === 1 ? '' : 's'}`,
    create: 'New project',
    filter: 'Filter by status',
    all: 'All',
    active: 'Active',
    on_hold: 'On hold',
    done: 'Done',
    archived: 'Archived',
    empty: 'No projects yet',
    emptyHint: 'Create your first project to get started.',
    emptyFiltered: 'No projects with this status',
    retry: 'Retry',
  },
};

const FILTERS = ['all', 'active', 'on_hold', 'done', 'archived'] as const;
type Filter = (typeof FILTERS)[number];

function ProjectsView() {
  const t = useT(TEXT);
  const { lang } = useLang();
  const sp = useSearchParams();
  const raw = sp.get('status');
  const status: Filter = FILTERS.includes(raw as Filter) ? (raw as Filter) : 'all';
  const me = useMe();
  const projects = useProjects();
  const [creating, setCreating] = useState(false);
  const canCreate = me.data?.canCreateProject === true;

  const all = projects.data ?? [];
  const live = all.filter((p) => !p.archivedAt);
  const archived = all.filter((p) => p.archivedAt);
  const pick = (f: Filter) => (f === 'archived' ? archived : f === 'all' ? live : live.filter((p) => p.status === f));
  const shown = pick(status);

  let body;
  if (projects.isPending) body = <ProjectsTableSkeleton />;
  else if (projects.isError)
    body = (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border p-6">
        <p className="text-sm">{errorMessage(projects.error, lang)}</p>
        <Button variant="outline" onClick={() => projects.refetch()}>
          {t.retry}
        </Button>
      </div>
    );
  else if (shown.length === 0)
    body = (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center">
        <p className="font-medium">{all.length === 0 ? t.empty : t.emptyFiltered}</p>
        {all.length === 0 && <p className="text-sm text-muted-foreground">{t.emptyHint}</p>}
        {all.length === 0 && canCreate && <Button onClick={() => setCreating(true)}>{t.create}</Button>}
      </div>
    );
  else body = <ProjectsTable projects={shown} />;

  return (
    <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          {projects.data && <p className="text-sm text-muted-foreground">{t.count(live.length)}</p>}
        </div>
        {canCreate && <Button onClick={() => setCreating(true)}>{t.create}</Button>}
      </div>
      <div role="group" aria-label={t.filter} className="mb-4 flex max-w-full gap-1 overflow-x-auto rounded-lg bg-muted p-1">
        {FILTERS.map((f) => (
          <Link
            key={f}
            replace
            scroll={false}
            href={f === 'all' ? routes.projects : `${routes.projects}?status=${f}`}
            aria-current={status === f ? 'true' : undefined}
            className={`shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition ${
              status === f ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t[f]}
            {projects.data && <span className="ml-1.5 text-xs tabular-nums">{pick(f).length}</span>}
          </Link>
        ))}
      </div>
      {body}
      {canCreate && <CreateProjectDialog open={creating} onOpenChange={setCreating} />}
    </div>
  );
}

// useSearchParams needs a Suspense boundary for static builds.
export default function ProjectsPage() {
  return (
    <Suspense>
      <ProjectsView />
    </Suspense>
  );
}
