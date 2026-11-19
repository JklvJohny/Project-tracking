'use client';
import { CalendarClock, CircleCheck, Columns3, TriangleAlert, Users, type LucideIcon } from 'lucide-react';
import { useT } from '../shared/i18n';
import type { Dashboard } from './queries';

const TEXT = {
  th: {
    open: 'งานที่ยังไม่เสร็จ',
    inProgress: (n: number) => `กำลังทำ ${n}`,
    overdue: 'เกินกำหนด',
    overdueSub: 'เลยกำหนดและยังไม่เสร็จ',
    week: 'ครบกำหนดใน 7 วัน',
    weekSub: 'งานที่ครบกำหนดในสัปดาห์นี้',
    unassigned: 'ยังไม่มอบหมาย',
    unassignedSub: (n: number): string => (n === 0 ? 'ทุกงานมีผู้รับผิดชอบแล้ว' : 'งานที่ยังไม่มีผู้รับผิดชอบ'),
    completion: 'ความคืบหน้า',
    doneOf: (d: number, t: number) => `เสร็จ ${d} จาก ${t} งาน`,
  },
  en: {
    open: 'Open tasks',
    inProgress: (n: number) => `${n} in progress`,
    overdue: 'Overdue',
    overdueSub: 'Past due and not done',
    week: 'Due in 7 days',
    weekSub: 'Open tasks due this week',
    unassigned: 'Unassigned',
    unassignedSub: (n: number): string => (n === 0 ? 'Every task has an owner' : 'Open tasks with no owner'),
    completion: 'Completion',
    doneOf: (d: number, t: number) => `${d} of ${t} tasks done`,
  },
};

function Tile({ icon: Icon, label, value, sub }: { icon: LucideIcon; label: string; value: string; sub?: string }) {
  return (
    <div role="group" aria-label={label} className="rounded-xl border bg-card p-4 shadow-sm">
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Icon className="h-4 w-4" aria-hidden="true" />
        {label}
      </p>
      <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight">{value}</p>
      {sub && <p className="mt-1.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function StatTiles({ totals }: { totals: Dashboard['totals'] }) {
  const t = useT(TEXT);
  const pct = totals.total ? Math.round((totals.done / totals.total) * 100) : 0;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      <Tile icon={Columns3} label={t.open} value={String(totals.open)} sub={t.inProgress(totals.inProgress)} />
      <Tile icon={TriangleAlert} label={t.overdue} value={String(totals.overdue)} sub={t.overdueSub} />
      <Tile icon={CalendarClock} label={t.week} value={String(totals.dueSoon)} sub={t.weekSub} />
      <Tile
        icon={Users}
        label={t.unassigned}
        value={String(totals.unassigned)}
        sub={t.unassignedSub(totals.unassigned)}
      />
      <div role="group" aria-label={t.completion} className="col-span-2 rounded-xl border bg-card p-4 shadow-sm md:col-span-1">
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <CircleCheck className="h-4 w-4" aria-hidden="true" />
          {t.completion}
        </p>
        <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight">{pct}%</p>
        <div
          role="progressbar"
          aria-label={t.completion}
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--s-done)' }} />
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">{t.doneOf(totals.done, totals.total)}</p>
      </div>
    </div>
  );
}
