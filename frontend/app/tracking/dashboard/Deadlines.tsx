'use client';
import { CalendarClock, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { AvatarStack } from '../shared/AvatarStack';
import { fmtDate } from '../shared/format';
import { useLang, useT } from '../shared/i18n';
import { routes } from '../shared/routes';
import type { Dashboard } from './queries';

const TEXT = {
  th: {
    none: 'ไม่มีงานที่ครบกำหนดใน 14 วันข้างหน้า',
    late: (n: number) => `เกินกำหนด ${n} วัน`,
    today: 'วันนี้',
    soon: (n: number) => `อีก ${n} วัน`,
    unassigned: 'ยังไม่มอบหมาย',
  },
  en: {
    none: 'Nothing due in the next 14 days.',
    late: (n: number) => `${n}d overdue`,
    today: 'Today',
    soon: (n: number) => `in ${n}d`,
    unassigned: 'Unassigned',
  },
};

export function Deadlines({ rows }: { rows: Dashboard['deadlines'] }) {
  const t = useT(TEXT);
  const { lang } = useLang();
  if (!rows.length) return <p className="py-6 text-center text-sm text-muted-foreground">{t.none}</p>;
  return (
    <ul className="-my-1 divide-y">
      {rows.map((r) => {
        const late = r.daysLeft < 0;
        const Icon = late ? TriangleAlert : CalendarClock;
        const when = late ? t.late(-r.daysLeft) : r.daysLeft === 0 ? t.today : t.soon(r.daysLeft);
        const tone = late
          ? 'text-red-700 dark:text-red-300'
          : r.daysLeft === 0
            ? 'text-amber-800 dark:text-amber-300'
            : 'text-muted-foreground';
        return (
          <li key={r.cardId}>
            <Link
              href={routes.card(r.projectId, r.cardId)}
              className="flex items-center gap-3 rounded py-2.5 hover:bg-accent/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            >
              <span title={fmtDate(r.dueDate, lang)} className={`inline-flex w-28 shrink-0 items-center gap-1 text-xs font-medium ${tone}`}>
                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {when}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{r.title}</span>
                <span className="block truncate text-xs text-muted-foreground">{`${r.projectName} · ${r.listName}`}</span>
              </span>
              {r.assignees.length ? (
                <AvatarStack users={r.assignees} max={3} />
              ) : (
                <span className="shrink-0 rounded-full border border-dashed px-2 py-0.5 text-[11px] text-muted-foreground">
                  {t.unassigned}
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
