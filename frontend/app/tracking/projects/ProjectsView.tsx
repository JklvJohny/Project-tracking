'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ChevronDown, LayoutGrid, Plus, Rows3 } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useMe, useProjects } from '../shared/api/queries';
import { errorMessage } from '../shared/errors';
import { useLang, useT } from '../shared/i18n';
import { routes } from '../shared/routes';
import { useStoredOpen } from '../board/useStoredOpen';
import { CreateProjectDialog } from './CreateProjectDialog';
import { ProjectsGrid } from './ProjectsGrid';
import { ProjectsTable, ProjectsTableSkeleton } from './ProjectsTable';
import type { ProjectRow } from './project-row';

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
    archivedTitle: 'โปรเจกต์ที่เก็บถาวร',
    archivedHint: 'ดูได้อย่างเดียว PM หรือแอดมินกู้คืนได้ด้วยปุ่มท้ายแถว',
    empty: 'ยังไม่มีโปรเจกต์',
    emptyHint: 'สร้างโปรเจกต์แรกเพื่อเริ่มต้น',
    emptyFiltered: 'ไม่มีโปรเจกต์ในสถานะนี้',
    retry: 'ลองอีกครั้ง',
    layout: 'รูปแบบการแสดงผล',
    table: 'มุมมองตาราง',
    cards: 'มุมมองการ์ด',
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
    archivedTitle: 'Archived projects',
    archivedHint: 'Read-only. A PM or admin restores one with the button at the end of its row.',
    empty: 'No projects yet',
    emptyHint: 'Create your first project to get started.',
    emptyFiltered: 'No projects with this status',
    retry: 'Retry',
    layout: 'Layout',
    table: 'Table view',
    cards: 'Card view',
  },
};

// Archived projects are their own section under the list, so they are not a status filter.
const FILTERS = ['all', 'active', 'on_hold', 'done'] as const;
type Filter = (typeof FILTERS)[number];

// Status and view live in the URL; each link carries the other so switching one keeps the other.
const href = (base: string, status: Filter, view: 'list' | 'grid') => {
  const q = new URLSearchParams();
  if (status !== 'all') q.set('status', status);
  if (view === 'grid') q.set('view', 'grid');
  const s = q.toString();
  return s ? `${base}?${s}` : base;
};

export const ARCHIVED_OPEN_KEY = 'pt-projects-archived-open';

/** Archived projects under the live ones, in the same layout; folding is remembered. #archived opens it. */
function ArchivedSection({ projects, view }: { projects: ProjectRow[]; view: 'list' | 'grid' }) {
  const t = useT(TEXT);
  const [open, setOpen] = useStoredOpen(ARCHIVED_OPEN_KEY, true);
  const ids = useId();
  useEffect(() => {
    // The old /tracking/archived page redirects here with #archived.
    if (window.location.hash === '#archived') setOpen(true);
  }, [setOpen]);
  return (
    <section id="archived" aria-labelledby={`${ids}-h`} className="mt-8 flex scroll-mt-4 flex-col gap-3">
      <div>
        <h2 id={`${ids}-h`}>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={`${ids}-list`}
            onClick={() => setOpen(!open)}
            className="-ml-1.5 inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-base font-semibold hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
          >
            <ChevronDown className={`size-4 transition-transform motion-reduce:transition-none ${open ? '' : '-rotate-90'}`} aria-hidden />
            {t.archivedTitle}
            <span className="rounded-full bg-muted px-1.5 text-xs font-normal text-muted-foreground tabular-nums">{projects.length}</span>
          </button>
        </h2>
        {open && <p className="text-xs text-muted-foreground">{t.archivedHint}</p>}
      </div>
      <div id={`${ids}-list`} hidden={!open}>
        {open && (view === 'grid' ? <ProjectsGrid projects={projects} /> : <ProjectsTable projects={projects} />)}
      </div>
    </section>
  );
}

/** The projects list: live projects with status filters and New project, then the archived ones. Status and view live in the URL. */
export function ProjectsView() {
  const base = routes.projects;
  const t = useT(TEXT);
  const { lang } = useLang();
  const sp = useSearchParams();
  const raw = sp.get('status');
  const status: Filter = FILTERS.includes(raw as Filter) ? (raw as Filter) : 'all';
  const view = sp.get('view') === 'grid' ? 'grid' : 'list';
  const me = useMe();
  const projects = useProjects();
  const [creating, setCreating] = useState(false);
  const canCreate = me.data?.canCreateProject === true;

  const all = projects.data ?? [];
  const live = all.filter((p) => !p.archivedAt);
  const archived = all.filter((p) => p.archivedAt);
  const pick = (f: Filter) => (f === 'all' ? live : live.filter((p) => p.status === f));
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
        {all.length === 0 && canCreate && <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden />
            {t.create}
          </Button>}
      </div>
    );
  else body = view === 'grid' ? <ProjectsGrid projects={shown} /> : <ProjectsTable projects={shown} />;

  return (
    <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          {projects.data && <p className="text-sm text-muted-foreground">{t.count(live.length)}</p>}
        </div>
        {canCreate && <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden />
            {t.create}
          </Button>}
      </div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label={t.filter} className="flex max-w-full gap-1 overflow-x-auto rounded-lg bg-muted p-1">
          {FILTERS.map((f) => (
            <Link
              key={f}
              replace
              scroll={false}
              href={href(base, f, view)}
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
        <div role="group" aria-label={t.layout} className="inline-flex rounded-md border bg-card p-0.5">
          {(
            [
              ['list', t.table, Rows3],
              ['grid', t.cards, LayoutGrid],
            ] as const
          ).map(([v, label, Icon]) => (
            <Link
              key={v}
              replace
              scroll={false}
              href={href(base, status, v)}
              aria-label={label}
              title={label}
              aria-current={view === v ? 'true' : undefined}
              className={`rounded p-1.5 ${view === v ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
            </Link>
          ))}
        </div>
      </div>
      {body}
      {archived.length > 0 && <ArchivedSection projects={archived} view={view} />}
      {canCreate && <CreateProjectDialog open={creating} onOpenChange={setCreating} />}
    </div>
  );
}
