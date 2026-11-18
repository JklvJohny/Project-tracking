'use client';
import { BarChart3, ChevronDown, Upload } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { useProjects } from '../shared/api/queries';
import { Avatar } from '../shared/Avatar';
import { errorMessage } from '../shared/errors';
import { fmtDate } from '../shared/format';
import { useLang, useT } from '../shared/i18n';
import { routes } from '../shared/routes';
import { Deadlines } from './Deadlines';
import { PriorityBars } from './PriorityBars';
import { StackedBars, type BarItem } from './StackedBars';
import { StatTiles } from './StatTiles';
import { useDashboard } from './queries';

const TEXT = {
  th: {
    title: 'แดชบอร์ด',
    asOf: (d: string) => `ข้อมูล ณ ${d}`,
    scope: 'แสดงข้อมูลของ',
    all: 'ทุกโปรเจกต์',
    import: 'นำเข้างาน',
    soon: 'เร็ว ๆ นี้',
    loading: 'กำลังโหลดแดชบอร์ด',
    emptyProjects: 'ยังไม่มีโปรเจกต์',
    emptyProjectsHint: 'สร้างโปรเจกต์เพื่อดูความคืบหน้า ภาระงาน และกำหนดส่งที่นี่',
    emptyOpen: 'ไม่มีงานที่ยังไม่เสร็จ',
    emptyOpenHint: 'งานทั้งหมดเสร็จแล้ว หรือยังไม่มีงานในโปรเจกต์',
    retry: 'ลองอีกครั้ง',
    byProject: 'งานแยกตามโปรเจกต์',
    byProjectSub: 'จำนวนการ์ดแยกตามสถานะ',
    byProjectCaption: 'งานแยกตามโปรเจกต์และสถานะ',
    workload: 'ภาระงานรายบุคคล',
    workloadSub: 'งานที่ยังไม่เสร็จของสมาชิกแต่ละคน',
    workloadCaption: 'งานที่ยังไม่เสร็จของแต่ละคนแยกตามสถานะ',
    priority: 'งานที่ยังไม่เสร็จตามความสำคัญ',
    prioritySub: (n: number) => `${n} งานที่ยังไม่เสร็จ`,
    deadlines: 'กำหนดส่ง',
    deadlinesSub: 'เกินกำหนดและครบกำหนดใน 14 วันข้างหน้า',
  },
  en: {
    title: 'Dashboard',
    asOf: (d: string) => `as of ${d}`,
    scope: 'Show data for',
    all: 'All projects',
    import: 'Import tasks',
    soon: 'Coming soon',
    loading: 'Loading dashboard',
    emptyProjects: 'No projects yet',
    emptyProjectsHint: 'Create a project to see progress, workload and deadlines here.',
    emptyOpen: 'No open tasks',
    emptyOpenHint: 'Every task is done, or the projects have no tasks yet.',
    retry: 'Retry',
    byProject: 'Tasks by project',
    byProjectSub: 'Count of cards by status',
    byProjectCaption: 'Tasks by project and status',
    workload: 'Workload by person',
    workloadSub: 'Open tasks assigned to each member',
    workloadCaption: 'Open tasks per person by status',
    priority: 'Open tasks by priority',
    prioritySub: (n: number) => `${n} open tasks`,
    deadlines: 'Deadlines',
    deadlinesSub: 'Overdue and due in the next 14 days',
  },
};

function Panel({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-xl border bg-card p-4 shadow-sm sm:p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mb-4 text-xs text-muted-foreground">{sub}</p>
      {children}
    </section>
  );
}

// Same footprint as the loaded page so nothing shifts when the data arrives.
function Skeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true">
      <span role="status" aria-label={label} className="sr-only">
        {label}
      </span>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-xl border bg-card p-4">
            <div className="h-3 w-20 rounded bg-muted" />
            <div className="mt-3 h-7 w-12 rounded bg-muted" />
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-64 animate-pulse rounded-xl border bg-card" />
        ))}
      </div>
    </div>
  );
}

function DashboardView() {
  const t = useT(TEXT);
  const { lang } = useLang();
  const router = useRouter();
  const raw = Number(useSearchParams().get('project'));
  const scope = Number.isInteger(raw) && raw > 0 ? raw : null;
  const projects = useProjects();
  const dash = useDashboard(scope);
  const live = (projects.data ?? []).filter((p) => !p.archivedAt);
  const asOf = dash.data?.asOf;

  const pick = (v: string) =>
    router.replace(v === 'all' ? routes.dashboard : `${routes.dashboard}?project=${v}`, { scroll: false });

  let body: ReactNode;
  if (dash.isPending) body = <Skeleton label={t.loading} />;
  else if (dash.isError)
    body = (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border p-6">
        <p className="text-sm">{errorMessage(dash.error, lang)}</p>
        <Button variant="outline" onClick={() => dash.refetch()}>
          {t.retry}
        </Button>
      </div>
    );
  else if (dash.data.byProject.length === 0) body = <Empty title={t.emptyProjects} hint={t.emptyProjectsHint} />;
  else {
    const d = dash.data;
    const projectItems: BarItem[] = d.byProject.map((p) => ({
      id: p.id,
      name: p.name,
      label: <span className="truncate">{p.name}</span>,
      counts: p,
      total: p.total,
    }));
    const workItems: BarItem[] = d.workload.map((w) => ({
      id: w.user.id,
      name: w.user.name,
      label: (
        <>
          <Avatar user={w.user} size="xs" />
          <span className="truncate">{w.user.name}</span>
        </>
      ),
      counts: w,
      total: w.open,
    }));
    body = (
      <>
        <StatTiles totals={d.totals} />
        {d.totals.open === 0 ? (
          <div className="mt-4">
            <Empty title={t.emptyOpen} hint={t.emptyOpenHint} />
          </div>
        ) : (
          <>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <Panel title={t.byProject} sub={t.byProjectSub}>
                <StackedBars items={projectItems} keys={['done', 'inProgress', 'notStarted', 'overdue']} caption={t.byProjectCaption} />
              </Panel>
              <Panel title={t.workload} sub={t.workloadSub}>
                <StackedBars items={workItems} keys={['inProgress', 'notStarted', 'overdue']} caption={t.workloadCaption} />
              </Panel>
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <Panel title={t.priority} sub={t.prioritySub(d.totals.open)}>
                <PriorityBars rows={d.byPriority} />
              </Panel>
              <Panel title={t.deadlines} sub={t.deadlinesSub}>
                <Deadlines rows={d.deadlines} />
              </Panel>
            </div>
          </>
        )}
      </>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          {asOf && <p className="text-sm text-muted-foreground">{t.asOf(fmtDate(asOf, lang))}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative">
            <span className="sr-only">{t.scope}</span>
            <select
              value={scope === null ? 'all' : String(scope)}
              onChange={(e) => pick(e.target.value)}
              className="h-9 max-w-[14rem] appearance-none rounded-md border bg-card pl-3 pr-8 text-sm hover:bg-accent"
            >
              <option value="all">{t.all}</option>
              {live.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
          </label>
          <Button variant="outline" disabled title={t.soon}>
            <Upload aria-hidden />
            {t.import}
          </Button>
        </div>
      </div>
      {body}
    </div>
  );
}

function Empty({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed px-6 py-16 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <BarChart3 className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
      </div>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}

// useSearchParams needs a Suspense boundary for static builds.
export default function DashboardPage() {
  return (
    <Suspense>
      <DashboardView />
    </Suspense>
  );
}
