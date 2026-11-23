'use client';
import { Calendar, Check, ListPlus, MessageSquare, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { memo } from 'react';
import { usePathname } from 'next/navigation';
import { useBoardHref } from './card-filter';
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
    subtasksNone: 'งานย่อย',
    progress: (d: number, n: number) => `งานย่อยเสร็จ ${d} จาก ${n}`,
    more: (n: number) => `+${n} รายการ`,
  },
  en: {
    overdue: 'Overdue',
    completed: 'Completed',
    comments: (n: number) => `${n} comment${n === 1 ? '' : 's'}`,
    open: (title: string) => `Open card ${title}`,
    assignees: 'Assignees',
    addSubtask: 'Add subtask',
    subtasksNone: 'Subtasks',
    progress: (d: number, n: number) => `${d} of ${n} subtasks done`,
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

// Shown on hover or keyboard focus within the row, always on touch screens, and while a popover it opened is open.
const HOVER_ONLY =
  'opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 has-[[data-state=open]]:opacity-100 [@media(hover:none)]:opacity-100';

export const CardPreview = memo(function CardPreview({
  projectId,
  card,
  users,
  labels,
  members,
  canEdit,
  canTick = canEdit,
  actionSpace = false,
}: {
  projectId: number;
  card: S['CardSummary'];
  users: S['User'][];
  labels: S['BoardLabel'][];
  members: S['BoardMember'][];
  /** Admin/PM/member on a live project: shows the "+" controls. */
  canEdit: boolean;
  /** May tick the subtask checkboxes: admin/PM on any card, a member only on cards assigned to them. */
  canTick?: boolean;
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
  const href = useBoardHref(pathname, 'card', card.id);

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
      {/* Editing shortcuts float in the corner and appear on hover or focus, so they never take a line of their own. */}
      {canEdit && (
        <span
          className={`absolute top-2 z-10 flex items-center gap-0.5 rounded-md bg-card/95 p-0.5 shadow-sm ring-1 ring-border ${actionSpace ? 'right-9' : 'right-2'} ${HOVER_ONLY}`}
        >
          <Link
            href={`${href}&focus=checklist`}
            scroll={false}
            draggable={false}
            aria-label={t.addSubtask}
            title={t.addSubtask}
            {...stopDrag}
            className="inline-flex size-6 items-center justify-center rounded text-foreground/70 hover:bg-accent hover:text-foreground"
          >
            <ListPlus className="size-4" aria-hidden />
          </Link>
          <AssignPopover projectId={projectId} card={card} members={members} />
        </span>
      )}
      {/* On touch screens the corner shortcuts always show: keep the labels clear of them. */}
      <div className={`flex flex-wrap items-center gap-1.5 ${actionSpace ? 'pr-7' : ''} ${canEdit ? (actionSpace ? '[@media(hover:none)]:pr-24' : '[@media(hover:none)]:pr-16') : ''}`}>
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
      {card.checklistTotal > 0 && (
        <div className="pointer-events-none relative mt-2.5">
          <div className="flex items-center gap-2" title={t.progress(card.checklistDone, card.checklistTotal)}>
            <span className="text-[11px] font-semibold text-foreground/80">{t.subtasksNone}</span>
            <span aria-hidden className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-(--s-done)"
                style={{ width: `${Math.round((card.checklistDone / card.checklistTotal) * 100)}%` }}
              />
            </span>
            <span className="text-[11px] text-muted-foreground tabular-nums">
              <span aria-hidden>
                {card.checklistDone}/{card.checklistTotal}
              </span>
              <span className="sr-only">{t.progress(card.checklistDone, card.checklistTotal)}</span>
            </span>
          </div>
          {card.checklistPreview.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {card.checklistPreview.map((i) => (
                <li key={i.id}>
                  <label
                    // A read-only row must let the click through to the card link underneath.
                    className={`flex w-fit max-w-full items-center gap-2 py-0.5 text-[13px] ${canTick ? 'pointer-events-auto cursor-pointer' : ''}`}
                    {...(canTick ? stopDrag : {})}
                  >
                    <Checkbox
                      checked={i.isDone}
                      disabled={!canTick}
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
      {(card.dueDate || card.commentCount > 0 || assignees.length > 0) && (
        <div className="pointer-events-none relative mt-2.5 flex min-h-6 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
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
          {assignees.length > 0 && (
            <span role="group" aria-label={t.assignees} className="ml-auto">
              <AvatarStack users={assignees} max={4} size="sm" />
            </span>
          )}
        </div>
      )}
    </div>
  );
});
