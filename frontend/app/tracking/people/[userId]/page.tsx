'use client';
import { Lock, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Suspense, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '../../shared/api/client';
import { useMe, useProjects } from '../../shared/api/queries';
import type { components } from '../../shared/api/schema';
import { Avatar } from '../../shared/Avatar';
import { errorMessage } from '../../shared/errors';
import { useLang, useT } from '../../shared/i18n';
import { routes } from '../../shared/routes';
import { StatusPill } from '../../shared/StatusPill';
import { SkillsByCategory, TaskCalendar, WorkloadStats } from '../parts';
import { usePerson } from '../queries';

type Role = components['schemas']['ProjectRole'];

const TEXT = {
  th: {
    workload: 'งานตอนนี้',
    skills: 'ทักษะ',
    noSkills: 'ยังไม่ได้ใส่ทักษะ',
    projects: 'โปรเจกต์ที่อยู่',
    noProjects: 'ยังไม่ได้อยู่ในโปรเจกต์ใด',
    open: (n: number) => (n === 0 ? 'ไม่มีงานค้าง' : `งานค้าง ${n}`),
    roles: { pm: 'PM', member: 'สมาชิก', viewer: 'ผู้ชม' } as Record<Role, string>,
    notMember: 'คุณไม่ได้อยู่ในโปรเจกต์นี้',
    calendar: 'ตารางงาน',
    calendarHint: 'งานที่ยังไม่เสร็จซึ่งมอบหมายให้คนนี้ ทุกโปรเจกต์',
    yours: 'นี่คือหน้าของคุณ',
    editOwn: 'แก้ไขโปรไฟล์',
    forbiddenTitle: 'ดูหน้านี้ไม่ได้',
    forbidden: 'เฉพาะผู้ดูแลระบบและ PM ที่ดูตารางงานของคนอื่นได้',
    back: 'กลับไปหน้าทีมงาน',
    retry: 'ลองอีกครั้ง',
  },
  en: {
    workload: 'Work right now',
    skills: 'Skills',
    noSkills: 'No skills listed yet',
    projects: 'Projects',
    noProjects: 'Not in any project yet',
    open: (n: number) => (n === 0 ? 'Nothing open' : `${n} open`),
    roles: { pm: 'PM', member: 'Member', viewer: 'Viewer' } as Record<Role, string>,
    notMember: 'You are not in this project',
    calendar: 'Schedule',
    calendarHint: 'Open cards assigned to this person, across every project.',
    yours: 'This is your own page',
    editOwn: 'Edit your profile',
    forbiddenTitle: 'You cannot open this page',
    forbidden: "Only admins and PMs can see other people's schedules.",
    back: 'Back to the team',
    retry: 'Retry',
  },
};

function Person({ userId }: { userId: number }) {
  const t = useT(TEXT);
  const { lang } = useLang();
  const q = usePerson(userId);
  const me = useMe();
  const projects = useProjects();
  // Projects the viewer can open: the others are listed (PMs plan across the department) but not linked.
  const visible = useMemo(() => new Set(projects.data?.map((p) => p.id) ?? []), [projects.data]);
  const here = routes.person(userId);

  if (q.isError) {
    const forbidden = q.error instanceof ApiError && q.error.code === 'forbidden';
    return (
      <div role="alert" className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-14 text-center">
        {forbidden && <Lock className="size-6 text-muted-foreground" aria-hidden />}
        <p className="font-semibold">{forbidden ? t.forbiddenTitle : errorMessage(q.error, lang)}</p>
        {forbidden && <p className="text-sm text-muted-foreground">{t.forbidden}</p>}
        {forbidden ? (
          <Button asChild variant="outline">
            <Link href={routes.team}>{t.back}</Link>
          </Button>
        ) : (
          <Button variant="outline" onClick={() => q.refetch()}>
            {t.retry}
          </Button>
        )}
      </div>
    );
  }
  const d = q.data;
  return (
    <>
      <section className="flex flex-col gap-4 rounded-xl border bg-card p-4 lg:flex-row lg:items-start">
        <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:text-left lg:flex-1">
          {d ? <Avatar user={{ id: d.person.userId, name: d.person.name, avatarUrl: d.person.avatarUrl }} size="xl" /> : <Skeleton className="size-24 rounded-full" />}
          <div className="flex min-w-0 flex-col gap-2">
            {d ? <h1 className="text-2xl font-semibold tracking-tight">{d.person.name}</h1> : <Skeleton className="h-8 w-48" />}
            {me.data?.user.id === userId && (
              <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {t.yours}
                <Link href={routes.profile} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                  <UserRound className="size-3.5" aria-hidden />
                  {t.editOwn}
                </Link>
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-2 lg:w-[30rem]">
          <h2 className="text-sm font-semibold">{t.workload}</h2>
          <WorkloadStats load={d?.person} />
        </div>
      </section>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <section aria-labelledby="person-projects" className="flex flex-col gap-3 rounded-xl border bg-card p-4">
          <h2 id="person-projects" className="font-semibold">
            {t.projects} {d && <span className="font-normal text-muted-foreground tabular-nums">({d.projects.length})</span>}
          </h2>
          {!d ? (
            <Skeleton className="h-20 w-full" />
          ) : d.projects.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.noProjects}</p>
          ) : (
            <ul className="flex flex-col divide-y rounded-lg border">
              {d.projects.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {visible.has(p.id) ? (
                      <Link href={routes.board(p.id)} className="hover:underline">
                        {p.name}
                      </Link>
                    ) : (
                      <span title={t.notMember}>{p.name}</span>
                    )}
                  </span>
                  <StatusPill status={p.status} />
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium">{t.roles[p.role]}</span>
                  <span className="w-24 text-right text-xs text-muted-foreground tabular-nums">{t.open(p.open)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="person-skills" className="flex flex-col gap-3 rounded-xl border bg-card p-4">
          <h2 id="person-skills" className="font-semibold">
            {t.skills}
          </h2>
          {!d ? (
            <Skeleton className="h-16 w-full" />
          ) : d.person.skills.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.noSkills}</p>
          ) : (
            <SkillsByCategory skills={d.person.skills} />
          )}
        </section>
      </div>

      <section aria-labelledby="person-calendar" className="flex flex-col gap-3 rounded-xl border bg-card p-4">
        <div>
          <h2 id="person-calendar" className="font-semibold">
            {t.calendar}
          </h2>
          <p className="text-xs text-muted-foreground">{t.calendarHint}</p>
        </div>
        <TaskCalendar tasks={d?.tasks} canOpen={(id) => visible.has(id)} here={here} />
      </section>
    </>
  );
}

/** Someone's page, opened by an admin or PM from a name or picture: their projects, skills and schedule. */
export default function PersonPage() {
  const { userId } = useParams<{ userId: string }>();
  const id = Number(userId);
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-5 sm:px-6 sm:py-6">
      {/* useSearchParams (the calendar month) needs a Suspense boundary for static builds. */}
      <Suspense>{Number.isInteger(id) && id > 0 ? <Person userId={id} /> : null}</Suspense>
    </div>
  );
}
