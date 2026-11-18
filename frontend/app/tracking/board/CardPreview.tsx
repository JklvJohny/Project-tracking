'use client';
import { Calendar, Check, MessageSquare, Plus, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { memo } from 'react';
import { usePathname } from 'next/navigation';
import { Checkbox } from '@/components/ui/checkbox';
import { useToggleChecklistItem } from '../card/mutations';
import { prefetchCard } from '../shared/api/queries';
import type { components } from '../shared/api/schema';
import { AvatarStack } from '../shared/AvatarStack';
import { fmtDate, isOverdue, priorityLabel, todayIso } from '../shared/format';
import { useLang, useT } from '../shared/i18n';
import { AssignPopover } from './AssignPopover';
import { stopDrag } from './stopDrag';

type S = components['schemas'];

const TEXT = {
  th: {
    overdue: 'เลยกำหนด',
    completed: 'เสร็จแล้ว',
    comments: (n: number) => `${n} ความคิดเห็น`,
    open: (title: string) => `เปิดการ์ด ${title}`,
    assignees: 'ผู้รับผิดชอบ',
    addSubtask: 'เพิ่มงานย่อย',
    subtasks: (n: number) => `${n} งานย่อย`,
    subtasksNone: 'งานย่อย',
    progress: (d: number, n: number) => `เสร็จ ${d} จาก ${n}`,
    more: (n: number) => `+${n} รายการ`,
  },
  en: {
    overdue: 'Overdue',
    completed: 'Completed',
    comments: (n: number) => `${n} comment${n === 1 ? '' : 's'}`,
    open: (title: string) => `Open card ${title}`,
    assignees: 'Assignees',
    addSubtask: 'Add subtask',
    subtasks: (n: number) => `${n} SUBTASKS`,
    subtasksNone: 'SUBTASKS',
    progress: (d: number, n: number) => `${d} of ${n} done`,
    more: (n: number) => `+${n} more`,
  },
};

// Label colours as utility palette classes (no raw hex), light + dark, as in index.html.
export const LABEL_CLASS: Record<S['LabelColor'], string> = {
  green: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-200',
  yellow: 'bg-amber-100 text-amber-900 dark:bg-amber-400/15 dark:text-amber-200',
  red: 'bg-red-100 text-red-800 dark:bg-red-400/15 dark:text-red-200',
  blue: 'bg-sky-100 text-sky-800 dark:bg-sky-400/15 dark:text-sky-200',
  purple: 'bg-violet-100 text-violet-800 dark:bg-violet-400/15 dark:text-violet-200',
  gray: 'bg-slate-100 text-slate-700 dark:bg-slate-400/15 dark:text-slate-200',
};

export const CardPreview = memo(function CardPreview({
  projectId,
  card,
  users,
  labels,
  members,
  canEdit,
  actionSpace = false,
}: {
  projectId: number;
  card: S['CardSummary'];
  users: S['User'][];
  labels: S['BoardLabel'][];
  members: S['BoardMember'][];
  /** Admin/PM/member on a live project: shows the "+" controls and enables the subtask checkboxes. */
  canEdit: boolean;
  /** Reserve the top-right corner for an overlaid action button. */
  actionSpace?: boolean;
}) {
  const t = useT(TEXT);
  const { lang } = useLang();
  const pathname = usePathname();
  const qc = useQueryClient();
  const toggle = useToggleChecklistItem(projectId);
  const overdue = isOverdue(card.dueDate, card.completedAt, todayIso());
  const assignees = card.assigneeIds.map((id) => users.find((u) => u.id === id)).filter((u) => !!u);
  const cardLabels = card.labelIds.map((id) => labels.find((l) => l.id === id)).filter((l) => !!l);
  const more = card.checklistTotal - card.checklistPreview.length;
  const href = `${pathname}?card=${card.id}`;

  // The whole row opens the card through a stretched link (Back closes the panel). The content wrappers let clicks
  // fall through to it (pointer-events-none); only the real controls take pointer events.
  return (
    <div className="relative px-4 py-3.5 transition-colors hover:bg-muted/40" onPointerEnter={() => prefetchCard(qc, card.id)}>
      <Link
        href={href}
        scroll={false}
        draggable={false}
        aria-label={t.open(card.title)}
        onFocus={() => prefetchCard(qc, card.id)}
        className="absolute inset-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      />
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
      {(assignees.length > 0 || canEdit) && (
        <div role="group" aria-label={t.assignees} className="pointer-events-none relative mt-2.5 flex items-center">
          {assignees.length > 0 && <AvatarStack users={assignees} max={4} size="md" />}
          {canEdit && (
            <span className={`pointer-events-auto ${assignees.length > 0 ? '-ml-1' : ''}`}>
              <AssignPopover projectId={projectId} card={card} members={members} />
            </span>
          )}
        </div>
      )}
      {(card.checklistTotal > 0 || canEdit) && (
        <div className="pointer-events-none relative mt-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold tracking-wide text-foreground/80 uppercase">
              {card.checklistTotal > 0 ? t.subtasks(card.checklistTotal) : t.subtasksNone}
              {card.checklistTotal > 0 && (
                <span
                  className="ml-1.5 font-medium tracking-normal text-muted-foreground normal-case tabular-nums"
                  title={t.progress(card.checklistDone, card.checklistTotal)}
                >
                  {card.checklistDone}/{card.checklistTotal}
                </span>
              )}
            </span>
            {canEdit && (
              <Link
                href={`${href}&focus=checklist`}
                scroll={false}
                draggable={false}
                aria-label={t.addSubtask}
                title={t.addSubtask}
                {...stopDrag}
                className="pointer-events-auto -mr-1 inline-flex size-6 items-center justify-center rounded text-foreground/70 hover:bg-accent hover:text-foreground"
              >
                <Plus className="size-4" aria-hidden />
              </Link>
            )}
          </div>
          {card.checklistPreview.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {card.checklistPreview.map((i) => (
                <li key={i.id}>
                  <label
                    // A read-only row must let the click through to the card link underneath.
                    className={`flex w-fit max-w-full items-center gap-2 py-0.5 text-[13px] ${canEdit ? 'pointer-events-auto cursor-pointer' : ''}`}
                    {...(canEdit ? stopDrag : {})}
                  >
                    <Checkbox
                      checked={i.isDone}
                      disabled={!canEdit}
                      onCheckedChange={(v) => toggle.mutate({ cardId: card.id, itemId: i.id, isDone: v === true })}
                      className="size-3.5"
                    />
                    <span className={`truncate ${i.isDone ? 'text-muted-foreground line-through' : ''}`}>{i.text}</span>
                  </label>
                </li>
              ))}
              {more > 0 && <li className="pl-5 text-xs text-muted-foreground">{t.more(more)}</li>}
            </ul>
          )}
        </div>
      )}
      {(card.dueDate || card.commentCount > 0) && (
        <div className="pointer-events-none relative mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
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
              {overdue ? (
                <TriangleAlert className="size-3.5" aria-hidden />
              ) : card.completedAt ? (
                <Check className="size-3.5" aria-hidden />
              ) : (
                <Calendar className="size-3.5" aria-hidden />
              )}
              {overdue ? `${t.overdue} ` : card.completedAt ? <span className="sr-only">{t.completed} </span> : null}
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
    </div>
  );
});
