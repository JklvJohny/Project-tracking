'use client';
import { AlarmClock, CircleCheck, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useMemo } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { MonthCalendar } from '../board/calendar/Calendar';
import type { TimelineCard } from '../board/timeline/timeline-model';
import { useT } from '../shared/i18n';
import { routes } from '../shared/routes';
import { allSkills, groupSkills, useTeam } from '../team/queries';
import type { Task } from './impact';

const TEXT = {
  th: { open: 'งานค้าง', overdue: 'เลยกำหนด', soon: 'ครบกำหนดใน 7 วัน', uncategorised: 'ไม่มีหมวดหมู่' },
  en: { open: 'Open', overdue: 'Overdue', soon: 'Due in 7 days', uncategorised: 'Uncategorised' },
};

function Stat({ icon: Icon, label, value, tone }: { icon: LucideIcon; label: string; value: number | undefined; tone?: string }) {
  return (
    <div className="flex min-w-28 flex-1 flex-col gap-1 rounded-lg border bg-background px-3 py-2.5">
      <span className={`flex items-center gap-1.5 text-xs ${tone ?? 'text-muted-foreground'}`}>
        <Icon className="size-3.5" aria-hidden />
        {label}
      </span>
      {value === undefined ? <Skeleton className="h-7 w-10" /> : <span className="text-2xl font-semibold tabular-nums">{value}</span>}
    </div>
  );
}

/** Open, overdue and due-soon counts; undefined while loading. */
export function WorkloadStats({ load }: { load: { open: number; overdue: number; dueSoon: number } | undefined }) {
  const t = useT(TEXT);
  return (
    <div className="flex flex-wrap gap-2">
      <Stat icon={CircleCheck} label={t.open} value={load?.open} />
      <Stat icon={TriangleAlert} label={t.overdue} value={load?.overdue} tone={load?.overdue ? 'text-(--s-overdue)' : undefined} />
      <Stat icon={AlarmClock} label={t.soon} value={load?.dueSoon} />
    </div>
  );
}

/** A person's skills under the department's categories, as the Team page groups them. */
export function SkillsByCategory({ skills }: { skills: string[] }) {
  const t = useT(TEXT);
  const team = useTeam();
  const groups = useMemo(() => {
    const mine = new Set(skills.map((s) => s.toLocaleLowerCase()));
    const known = team.data ? allSkills(team.data.people, team.data.catalog) : [];
    // A skill the team list does not know yet (just saved) still shows, uncategorised.
    const extra = skills
      .filter((s) => !known.some((k) => k.name.toLocaleLowerCase() === s.toLocaleLowerCase()))
      .map((name) => ({ name, count: 1, categoryId: null }));
    return groupSkills(
      [...known.filter((s) => mine.has(s.name.toLocaleLowerCase())), ...extra],
      team.data?.categories ?? [],
    ).filter((g) => g.skills.length > 0);
  }, [skills, team.data]);
  return (
    <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[minmax(8rem,auto)_1fr]">
      {groups.map(({ category, skills: list }) => (
        <div key={category?.id ?? 'none'} className="contents">
          <dt className={`pt-0.5 text-xs font-semibold ${category ? '' : 'text-muted-foreground'}`}>{category?.name ?? t.uncategorised}</dt>
          <dd>
            <ul className="flex flex-wrap gap-1.5">
              {list.map((s) => (
                <li key={s.name} className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">
                  {s.name}
                </li>
              ))}
            </ul>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Someone's open cards on a month calendar. A card links to its board when the viewer can open that project;
 * otherwise (a PM looking at work in a project they are not in) it stays on this page.
 */
export function TaskCalendar({ tasks, canOpen, here }: { tasks: Task[] | undefined; canOpen: (projectId: number) => boolean; here: string }) {
  // The calendar takes board cards; a task carries all it needs for one.
  const cards = useMemo<TimelineCard[] | undefined>(
    () =>
      tasks?.map((x) => ({
        id: x.cardId,
        listId: 0,
        title: x.title,
        priority: x.priority,
        startDate: x.startDate,
        dueDate: x.dueDate,
        position: '',
        completedAt: null,
        updatedAt: '',
        labelIds: [],
        assigneeIds: x.assignees.map((a) => a.id),
        checklistTotal: x.checklistTotal,
        checklistDone: x.checklistDone,
        commentCount: 0,
        checklistPreview: [],
      })),
    [tasks],
  );
  const users = useMemo(() => new Map(tasks?.flatMap((x) => x.assignees.map((a) => [a.id, a] as const)) ?? []), [tasks]);
  const projectOf = useMemo(() => new Map(tasks?.map((x) => [x.cardId, x.projectId]) ?? []), [tasks]);
  return (
    <MonthCalendar
      cards={cards}
      users={users}
      fit={false}
      cardHref={(id) => {
        const p = projectOf.get(id);
        return p !== undefined && canOpen(p) ? routes.card(p, id) : here;
      }}
    />
  );
}
