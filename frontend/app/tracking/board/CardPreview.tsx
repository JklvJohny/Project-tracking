'use client';
import { CheckSquare, MessageSquare } from 'lucide-react';
import Link from 'next/link';
import { memo } from 'react';
import { usePathname } from 'next/navigation';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { components } from '../shared/api/schema';
import { fmtDate, isOverdue, priorityLabel, todayIso } from '../shared/format';
import { useLang, useT } from '../shared/i18n';

type S = components['schemas'];

const TEXT = {
  th: {
    overdue: 'เลยกำหนด',
    comments: (n: number) => `${n} ความคิดเห็น`,
    checklist: (d: number, n: number) => `เช็กลิสต์ ${d} จาก ${n}`,
    assignees: 'ผู้รับผิดชอบ',
  },
  en: {
    overdue: 'Overdue',
    comments: (n: number) => `${n} comment${n === 1 ? '' : 's'}`,
    checklist: (d: number, n: number) => `Checklist ${d} of ${n}`,
    assignees: 'Assignees',
  },
};

// Label colours as utility palette classes (no raw hex), light + dark, as in index.html.
const LABEL_CLASS: Record<S['LabelColor'], string> = {
  green: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-200',
  yellow: 'bg-amber-100 text-amber-900 dark:bg-amber-400/15 dark:text-amber-200',
  red: 'bg-red-100 text-red-800 dark:bg-red-400/15 dark:text-red-200',
  blue: 'bg-sky-100 text-sky-800 dark:bg-sky-400/15 dark:text-sky-200',
  purple: 'bg-violet-100 text-violet-800 dark:bg-violet-400/15 dark:text-violet-200',
  gray: 'bg-slate-100 text-slate-700 dark:bg-slate-400/15 dark:text-slate-200',
};

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => Array.from(w)[0] ?? '')
    .join('')
    .toUpperCase();

export const CardPreview = memo(function CardPreview({
  card,
  users,
  labels,
  actionSpace = false,
}: {
  card: S['CardSummary'];
  users: S['User'][];
  labels: S['BoardLabel'][];
  /** Reserve the top-right corner for an overlaid action button. */
  actionSpace?: boolean;
}) {
  const t = useT(TEXT);
  const { lang } = useLang();
  const pathname = usePathname();
  const overdue = isOverdue(card.dueDate, card.completedAt, todayIso());
  const assignees = card.assigneeIds.map((id) => users.find((u) => u.id === id)).filter((u) => !!u);
  const cardLabels = card.labelIds.map((id) => labels.find((l) => l.id === id)).filter((l) => !!l);
  const pct = card.checklistTotal ? Math.round((card.checklistDone / card.checklistTotal) * 100) : 0;

  // A plain link keeping the path: the panel (Task 15) opens from ?card= and Back closes it.
  return (
    <Link
      href={`${pathname}?card=${card.id}`}
      scroll={false}
      draggable={false}
      className="block px-4 py-3.5 transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
    >
      <div className={`flex flex-wrap items-center gap-1.5 ${actionSpace ? 'pr-7' : ''}`}>
        <span
          className="rounded px-1.5 py-0.5 text-[10px] leading-4 font-bold tracking-wide text-white uppercase"
          style={{ background: `var(--pb-${card.priority})` }}
        >
          {priorityLabel(card.priority, lang)}
        </span>
        {cardLabels.map((l) => (
          <span
            key={l.id}
            className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${LABEL_CLASS[l.color]}`}
          >
            {l.name}
          </span>
        ))}
      </div>
      <p className="mt-2 text-[15px] leading-snug font-semibold break-words">{card.title}</p>
      {assignees.length > 0 && (
        <div role="group" aria-label={t.assignees} className="mt-2.5 flex items-center -space-x-1.5">
          {assignees.slice(0, 4).map((u) => (
            <Avatar key={u.id} className="size-7 ring-2 ring-card" title={u.name}>
              {u.avatarUrl && <AvatarImage src={u.avatarUrl} alt={u.name} />}
              <AvatarFallback className="text-[10px]">{initials(u.name)}</AvatarFallback>
            </Avatar>
          ))}
          {assignees.length > 4 && (
            <span className="z-10 pl-2.5 text-xs text-muted-foreground">+{assignees.length - 4}</span>
          )}
        </div>
      )}
      {card.checklistTotal > 0 && (
        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <CheckSquare className="size-3.5 shrink-0" aria-hidden />
          <span className="tabular-nums">
            {card.checklistDone}/{card.checklistTotal}
          </span>
          <div
            role="progressbar"
            aria-label={t.checklist(card.checklistDone, card.checklistTotal)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
          >
            <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      {(card.dueDate || card.commentCount > 0) && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {card.dueDate && (
            <span
              className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 ${
                overdue
                  ? 'bg-red-100 font-medium text-red-800 dark:bg-red-400/15 dark:text-red-200'
                  : card.completedAt
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-200'
                    : ''
              }`}
            >
              {overdue ? `${t.overdue} ` : ''}
              {fmtDate(card.dueDate, lang)}
            </span>
          )}
          {card.commentCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <MessageSquare className="size-3.5" aria-hidden />
              <span aria-hidden>{card.commentCount}</span>
              <span className="sr-only">{t.comments(card.commentCount)}</span>
            </span>
          )}
        </div>
      )}
    </Link>
  );
});
