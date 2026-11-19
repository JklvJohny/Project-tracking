'use client';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, ListChecks, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';
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
    caption: 'งานที่ยังไม่เสร็จที่ได้รับมอบหมาย แยกตามกำหนดส่ง',
    groups: { overdue: 'เลยกำหนด', today: 'วันนี้', week: 'ภายใน 7 วัน', later: 'หลังจากนั้น', none: 'ไม่มีกำหนดส่ง' } as Record<Group, string>,
    card: 'การ์ด',
    priority: 'ความสำคัญ',
    due: 'กำหนดส่ง',
    subtasks: 'งานย่อย',
    with: 'ทำร่วมกับ',
    late: (n: number) => `เกิน ${n} วัน`,
    soon: (n: number) => `อีก ${n} วัน`,
    todayShort: 'วันนี้',
    loading: 'กำลังโหลดงานของฉัน',
    retry: 'ลองอีกครั้ง',
    empty: 'ไม่มีงานค้าง',
    emptyHint: 'การ์ดที่ได้รับมอบหมายและยังไม่เสร็จจะแสดงที่นี่',
    summary: 'สรุปงาน',
  },
  en: {
    title: 'My tasks',
    asOf: (d: string) => `as of ${d}`,
    caption: 'Open cards assigned to me, by due date',
    groups: { overdue: 'Overdue', today: 'Today', week: 'Next 7 days', later: 'Later', none: 'No due date' } as Record<Group, string>,
    card: 'Card',
    priority: 'Priority',
    due: 'Due',
    subtasks: 'Subtasks',
    with: 'With',
    late: (n: number) => `${n}d overdue`,
    soon: (n: number) => `in ${n}d`,
    todayShort: 'Today',
    loading: 'Loading my tasks',
    retry: 'Retry',
    empty: 'Nothing open',
    emptyHint: 'Open cards assigned to you show up here.',
    summary: 'Summary',
  },
};

function groupOf(t: Task): Group {
  const d = t.daysLeft;
  if (d === null) return 'none';
  if (d < 0) return 'overdue';
  if (d === 0) return 'today';
  return d <= 7 ? 'week' : 'later';
}

const TONE: Record<Group, string> = {
  overdue: 'text-red-700 dark:text-red-300',
  today: 'text-amber-800 dark:text-amber-300',
  week: 'text-foreground',
  later: 'text-muted-foreground',
  none: 'text-muted-foreground',
};

const TH = 'px-3 py-2 font-medium whitespace-nowrap';
const TD = 'px-3 py-2.5 align-middle';

/** The caller's open cards across projects, reached from their avatar in the header. */
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
      <div aria-busy="true" className="space-y-2 rounded-xl border bg-card p-4">
        <span role="status" aria-label={t.loading} className="sr-only">
          {t.loading}
        </span>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-9 animate-pulse rounded bg-muted" />
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
      <>
        <ul aria-label={t.summary} className="mb-4 flex flex-wrap gap-2">
          {GROUPS.filter((g) => by.get(g)!.length > 0).map((g) => (
            <li key={g}>
              <a
                href={`#group-${g}`}
                className={`inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-xs font-medium hover:bg-accent ${TONE[g]}`}
              >
                {g === 'overdue' && <TriangleAlert className="size-3.5" aria-hidden />}
                {t.groups[g]}
                <span className="tabular-nums">{by.get(g)!.length}</span>
              </a>
            </li>
          ))}
        </ul>
        {/* relative: the avatars' sr-only names are absolutely positioned and would widen the page from outside the scroller. */}
        <div className="relative overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <caption className="sr-only">{t.caption}</caption>
            <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className={TH}>{t.card}</th>
                <th scope="col" className={TH}>{t.priority}</th>
                <th scope="col" className={TH}>{t.due}</th>
                <th scope="col" className={TH}>{t.subtasks}</th>
                <th scope="col" className={TH}>{t.with}</th>
              </tr>
            </thead>
            <tbody>
              {GROUPS.map((g) => {
                const rows = by.get(g)!;
                if (rows.length === 0) return null;
                return (
                  <Fragment key={g}>
                    <tr id={`group-${g}`} className="scroll-mt-4 border-b bg-muted/30">
                      <th scope="colgroup" colSpan={5} className={`px-3 py-1.5 text-left text-xs font-semibold ${TONE[g]}`}>
                        {t.groups[g]} <span className="font-normal text-muted-foreground tabular-nums">({rows.length})</span>
                      </th>
                    </tr>
                    {rows.map((task) => (
                      <Row key={task.cardId} task={task} group={g} meId={meId} />
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-6">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        {q.data && <p className="text-sm text-muted-foreground">{t.asOf(fmtDate(q.data.asOf, lang))}</p>}
      </div>
      {body}
    </div>
  );
}

function Row({ task, group, meId }: { task: Task; group: Group; meId: number | undefined }) {
  const t = useT(TEXT);
  const { lang } = useLang();
  const others = task.assignees.filter((u) => u.id !== meId);
  const d = task.daysLeft;
  const when = d === null ? null : d < 0 ? t.late(-d) : d === 0 ? t.todayShort : t.soon(d);
  return (
    <tr className="border-b last:border-0 hover:bg-accent/50">
      <td className={`${TD} max-w-96 min-w-56`}>
        <Link href={routes.card(task.projectId, task.cardId)} className="font-medium break-words hover:underline">
          {task.title}
        </Link>
        <p className="truncate text-xs text-muted-foreground">{`${task.projectName} · ${task.listName}`}</p>
      </td>
      <td className={TD}>
        <span
          className="rounded px-1.5 py-0.5 text-[10px] leading-4 font-bold tracking-wide whitespace-nowrap text-white uppercase"
          style={{ background: `var(--pb-${task.priority})` }}
        >
          {priorityLabel(task.priority, lang)}
        </span>
      </td>
      <td className={`${TD} whitespace-nowrap`}>
        {task.dueDate ? (
          <span className="flex flex-col">
            <span className={`inline-flex items-center gap-1 text-xs font-medium ${TONE[group]}`}>
              {group === 'overdue' ? <TriangleAlert className="size-3.5" aria-hidden /> : <CalendarClock className="size-3.5" aria-hidden />}
              {when}
            </span>
            <span className="text-xs text-muted-foreground">{fmtDate(task.dueDate, lang)}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">–</span>
        )}
      </td>
      <td className={`${TD} whitespace-nowrap`}>
        {task.checklistTotal > 0 ? (
          <span className="inline-flex items-center gap-2">
            <span aria-hidden className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-(--s-done)"
                style={{ width: `${Math.round((task.checklistDone / task.checklistTotal) * 100)}%` }}
              />
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {task.checklistDone}/{task.checklistTotal}
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground">–</span>
        )}
      </td>
      <td className={TD}>{others.length > 0 ? <AvatarStack users={others} max={4} /> : <span className="text-muted-foreground">–</span>}</td>
    </tr>
  );
}
