'use client';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, CalendarDays, CalendarOff, CalendarRange, ListChecks, TriangleAlert, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { api } from '../shared/api/client';
import { useMe } from '../shared/api/queries';
import type { components } from '../shared/api/schema';
import { AvatarStack } from '../shared/AvatarStack';
import { errorMessage } from '../shared/errors';
import { fmtDate, priorityLabel } from '../shared/format';
import { useLang, useT } from '../shared/i18n';
import { routes } from '../shared/routes';

type MyTasks = components['schemas']['MyTasks'];
type Task = MyTasks['tasks'][number];
type Group = 'overdue' | 'today' | 'week' | 'later' | 'none';
const GROUPS: Group[] = ['overdue', 'today', 'week', 'later', 'none'];

const myTasksKey = ['my-tasks'] as const;

const TEXT = {
  th: {
    title: 'งานของฉัน',
    asOf: (d: string) => `ข้อมูล ณ ${d}`,
    open: (n: number) => `${n} งานที่ยังไม่เสร็จ`,
    groups: { overdue: 'เลยกำหนด', today: 'วันนี้', week: 'ภายใน 7 วัน', later: 'หลังจากนั้น', none: 'ไม่มีกำหนดส่ง' } as Record<Group, string>,
    count: (n: number) => `${n} งาน`,
    tasksIn: (g: string) => `งานกลุ่ม ${g}`,
    nothing: 'ไม่มีงาน',
    late: (n: number) => `เกิน ${n} วัน`,
    soon: (n: number) => `อีก ${n} วัน`,
    todayShort: 'วันนี้',
    progress: (d: number, n: number) => `งานย่อยเสร็จ ${d} จาก ${n}`,
    with: 'ทำร่วมกับ',
    loading: 'กำลังโหลดงานของฉัน',
    retry: 'ลองอีกครั้ง',
    empty: 'ไม่มีงานค้าง',
    emptyHint: 'การ์ดที่ได้รับมอบหมายและยังไม่เสร็จจะแสดงที่นี่',
  },
  en: {
    title: 'My tasks',
    asOf: (d: string) => `as of ${d}`,
    open: (n: number) => `${n} open task${n === 1 ? '' : 's'}`,
    groups: { overdue: 'Overdue', today: 'Today', week: 'Next 7 days', later: 'Later', none: 'No due date' } as Record<Group, string>,
    count: (n: number) => `${n} task${n === 1 ? '' : 's'}`,
    tasksIn: (g: string) => `${g} tasks`,
    nothing: 'Nothing here',
    late: (n: number) => `${n}d overdue`,
    soon: (n: number) => `in ${n}d`,
    todayShort: 'Today',
    progress: (d: number, n: number) => `${d} of ${n} subtasks done`,
    with: 'With',
    loading: 'Loading my tasks',
    retry: 'Retry',
    empty: 'Nothing open',
    emptyHint: 'Open cards assigned to you show up here.',
  },
};

function groupOf(t: Task): Group {
  const d = t.daysLeft;
  if (d === null) return 'none';
  if (d < 0) return 'overdue';
  if (d === 0) return 'today';
  return d <= 7 ? 'week' : 'later';
}

const ICON: Record<Group, LucideIcon> = {
  overdue: TriangleAlert,
  today: CalendarClock,
  week: CalendarDays,
  later: CalendarRange,
  none: CalendarOff,
};

// Status is never colour alone: each column also has its icon and name, each card its due text.
const TONE: Record<Group, string> = {
  overdue: 'text-red-700 dark:text-red-300',
  today: 'text-amber-800 dark:text-amber-300',
  week: 'text-foreground',
  later: 'text-muted-foreground',
  none: 'text-muted-foreground',
};
const CHIP: Record<Group, string> = {
  overdue: 'bg-red-100 text-red-800 dark:bg-red-400/15 dark:text-red-200',
  today: 'bg-amber-100 text-amber-900 dark:bg-amber-400/15 dark:text-amber-200',
  week: 'bg-muted text-foreground',
  later: 'bg-muted text-muted-foreground',
  none: 'bg-muted text-muted-foreground',
};

// Board-sized columns that scroll sideways; on wide screens all five share the width.
const COLUMN = 'flex w-72 shrink-0 flex-col rounded-xl border border-border/70 bg-muted/50 xl:w-auto';

/** The caller's open cards across projects as due-date columns, reached from the avatar menu. */
export default function MyTasksPage() {
  const t = useT(TEXT);
  const { lang } = useLang();
  const me = useMe();
  // Cards change on other pages; always refetch on arrival instead of trusting a 15 s old copy.
  const q = useQuery({ queryKey: myTasksKey, queryFn: () => api<MyTasks>('/me/tasks'), staleTime: 0 });
  const meId = me.data?.user?.id;

  let body: ReactNode;
  if (q.isPending)
    body = (
      <div aria-busy="true" className="flex gap-3 overflow-hidden xl:grid xl:grid-cols-5">
        <span role="status" aria-label={t.loading} className="sr-only">
          {t.loading}
        </span>
        {GROUPS.map((g) => (
          <div key={g} className={`${COLUMN} h-64 animate-pulse`} />
        ))}
      </div>
    );
  else if (q.isError)
    body = (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border p-6">
        <p className="text-sm">{errorMessage(q.error, lang)}</p>
        <Button variant="outline" onClick={() => q.refetch()}>
          {t.retry}
        </Button>
      </div>
    );
  else if (q.data.tasks.length === 0)
    body = (
      <div className="flex flex-col items-center rounded-xl border border-dashed px-6 py-16 text-center">
        <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
          <ListChecks className="size-6 text-muted-foreground" aria-hidden />
        </div>
        <h2 className="text-base font-semibold">{t.empty}</h2>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{t.emptyHint}</p>
      </div>
    );
  else {
    const by = new Map<Group, Task[]>(GROUPS.map((g) => [g, []]));
    for (const task of q.data.tasks) by.get(groupOf(task))!.push(task);
    body = (
      // relative: the avatars' sr-only names are absolutely positioned and would widen the page from outside the scroller.
      // scroll-px keeps the snapped first column off the edge; items-start lets each column end with its last card.
      <div className="relative -mx-4 flex scroll-px-4 snap-x items-start gap-3 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:scroll-px-6 sm:px-6 xl:mx-0 xl:grid xl:grid-cols-5 xl:overflow-visible xl:px-0">
        {GROUPS.map((g) => {
          const rows = by.get(g)!;
          const Icon = ICON[g];
          return (
            <section key={g} aria-labelledby={`mt-${g}`} className={`${COLUMN} snap-start`}>
              <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5">
                <Icon className={`size-4 shrink-0 ${TONE[g]}`} aria-hidden />
                <h2 id={`mt-${g}`} className={`min-w-0 flex-1 truncate text-sm font-semibold ${TONE[g]}`}>
                  {t.groups[g]}
                </h2>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground tabular-nums">
                  <span aria-hidden>{rows.length}</span>
                  <span className="sr-only">{t.count(rows.length)}</span>
                </span>
              </div>
              {rows.length === 0 ? (
                <p className="mx-2 mb-2 rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
                  {t.nothing}
                </p>
              ) : (
                <ol
                  aria-label={t.tasksIn(t.groups[g])}
                  className="mx-2 mb-2 flex flex-col divide-y divide-border overflow-hidden rounded-lg bg-card shadow-sm ring-1 ring-border/60"
                >
                  {rows.map((task) => (
                    <li key={task.cardId}>
                      <TaskCard task={task} group={g} meId={meId} />
                    </li>
                  ))}
                </ol>
              )}
            </section>
          );
        })}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[96rem] px-4 py-5 sm:px-6 sm:py-6">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        {q.data && (
          <p className="text-sm text-muted-foreground">
            {t.open(q.data.tasks.length)} · {t.asOf(fmtDate(q.data.asOf, lang))}
          </p>
        )}
      </div>
      {body}
    </div>
  );
}

function TaskCard({ task, group, meId }: { task: Task; group: Group; meId: number | undefined }) {
  const t = useT(TEXT);
  const { lang } = useLang();
  const others = task.assignees.filter((u) => u.id !== meId);
  const d = task.daysLeft;
  const when = d === null ? null : d < 0 ? t.late(-d) : d === 0 ? t.todayShort : t.soon(d);
  const pct = task.checklistTotal > 0 ? Math.round((task.checklistDone / task.checklistTotal) * 100) : 0;
  return (
    <Link
      href={routes.card(task.projectId, task.cardId)}
      className="block px-3.5 py-3 transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
    >
      <span
        className="inline-block rounded px-1.5 py-0.5 text-[10px] leading-4 font-bold tracking-wide text-white uppercase"
        style={{ background: `var(--pb-${task.priority})` }}
      >
        {priorityLabel(task.priority, lang)}
      </span>
      <span className="mt-1.5 block text-[15px] leading-snug font-semibold break-words">{task.title}</span>
      <span className="mt-0.5 block truncate text-xs text-muted-foreground">{`${task.projectName} · ${task.listName}`}</span>
      {task.checklistTotal > 0 && (
        <span className="mt-2.5 flex items-center gap-2" title={t.progress(task.checklistDone, task.checklistTotal)}>
          <span aria-hidden className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <span className="block h-full rounded-full bg-(--s-done)" style={{ width: `${pct}%` }} />
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            <span aria-hidden>
              {task.checklistDone}/{task.checklistTotal}
            </span>
            <span className="sr-only">{t.progress(task.checklistDone, task.checklistTotal)}</span>
          </span>
        </span>
      )}
      {(task.dueDate || others.length > 0) && (
        <span className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          {task.dueDate && (
            <>
              <span
                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${CHIP[group]}`}
              >
                {group === 'overdue' ? <TriangleAlert className="size-3.5" aria-hidden /> : <CalendarClock className="size-3.5" aria-hidden />}
                {when}
              </span>
              <span className="text-xs whitespace-nowrap text-muted-foreground">{fmtDate(task.dueDate, lang)}</span>
            </>
          )}
          {others.length > 0 && (
            <span role="group" aria-label={t.with} className="ml-auto">
              <AvatarStack users={others} max={3} />
            </span>
          )}
        </span>
      )}
    </Link>
  );
}
