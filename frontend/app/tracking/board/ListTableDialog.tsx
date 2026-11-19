'use client';
import { Check, CheckCircle2, MessageSquare, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { prefetchCard, useBoard } from '../shared/api/queries';
import { AvatarStack } from '../shared/AvatarStack';
import { fmtDate, isOverdue, priorityLabel, todayIso } from '../shared/format';
import { useLang, useT } from '../shared/i18n';
import { LABEL_CLASS } from './CardPreview';

const TEXT = {
  th: {
    title: (n: string) => `ลิสต์ ${n}`,
    count: (n: number) => `${n} การ์ด`,
    done: 'ลิสต์เสร็จสิ้น',
    card: 'การ์ด',
    priority: 'ความสำคัญ',
    assignees: 'ผู้รับผิดชอบ',
    start: 'เริ่ม',
    due: 'กำหนดส่ง',
    subtasks: 'งานย่อย',
    comments: 'ความคิดเห็น',
    overdue: 'เลยกำหนด',
    completed: 'เสร็จแล้ว',
    empty: 'ยังไม่มีการ์ด',
    gone: 'ไม่พบลิสต์นี้',
    loading: 'กำลังโหลด',
    open: (title: string) => `เปิดการ์ด ${title}`,
  },
  en: {
    title: (n: string) => `List ${n}`,
    count: (n: number) => `${n} card${n === 1 ? '' : 's'}`,
    done: 'Done list',
    card: 'Card',
    priority: 'Priority',
    assignees: 'Assignees',
    start: 'Start',
    due: 'Due',
    subtasks: 'Subtasks',
    comments: 'Comments',
    overdue: 'Overdue',
    completed: 'Completed',
    empty: 'No cards yet',
    gone: 'List not found',
    loading: 'Loading',
    open: (title: string) => `Open card ${title}`,
  },
};

const TH = 'px-3 py-2 font-medium whitespace-nowrap';
const TD = 'px-3 py-2.5 align-middle';

/**
 * One list's cards as a table (opened from the list name, `?list=<id>`). Four columns side by side are hard to
 * scan; a table lines the fields up. Card links keep `list`, so closing the card panel returns here.
 */
export function ListTableDialog({ projectId, listId, onClose }: { projectId: number; listId: number; onClose: () => void }) {
  const t = useT(TEXT);
  const { lang } = useLang();
  const pathname = usePathname();
  const qc = useQueryClient();
  const board = useBoard(projectId);
  const b = board.data;
  const list = b?.lists.find((l) => l.id === listId);
  const cards = b && list ? b.cards.filter((c) => c.listId === listId) : [];
  const today = todayIso();

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        aria-describedby={undefined}
        className="flex max-h-[85dvh] flex-col gap-3 sm:max-w-5xl"
        onCloseAutoFocus={(e) => {
          // No Radix trigger to restore: hand focus back to the list name that opened the table.
          e.preventDefault();
          document.querySelector<HTMLElement>(`a[href$="?list=${listId}"]`)?.focus();
        }}
      >
        <div className="flex items-center gap-2 pr-8">
          <DialogTitle className="truncate text-base">{list ? list.name : b ? t.gone : t.loading}</DialogTitle>
          {list?.isDone && <CheckCircle2 className="size-4 shrink-0 text-(--s-done)" aria-label={t.done} role="img" />}
          {list && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground tabular-nums">
              {t.count(cards.length)}
            </span>
          )}
        </div>
        {b && list && (
          <div className="min-h-0 overflow-auto rounded-lg border bg-card">
            <table className="w-full text-sm">
              <caption className="sr-only">{t.title(list.name)}</caption>
              <thead className="sticky top-0 z-10 border-b bg-muted text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className={TH}>{t.card}</th>
                  <th scope="col" className={TH}>{t.priority}</th>
                  <th scope="col" className={TH}>{t.assignees}</th>
                  <th scope="col" className={TH}>{t.start}</th>
                  <th scope="col" className={TH}>{t.due}</th>
                  <th scope="col" className={TH}>{t.subtasks}</th>
                  <th scope="col" className={`${TH} text-right`}>
                    <MessageSquare className="ml-auto size-3.5" aria-hidden />
                    <span className="sr-only">{t.comments}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {cards.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-xs text-muted-foreground">
                      {t.empty}
                    </td>
                  </tr>
                )}
                {cards.map((c) => {
                  const overdue = isOverdue(c.dueDate, c.completedAt, today);
                  const assignees = c.assigneeIds.map((id) => b.users.find((u) => u.id === id)).filter((u) => !!u);
                  const labels = c.labelIds.map((id) => b.labels.find((l) => l.id === id)).filter((l) => !!l);
                  return (
                    <tr key={c.id} className="border-b last:border-0 hover:bg-accent/50">
                      <td className={`${TD} max-w-80 min-w-56`}>
                        <Link
                          href={`${pathname}?list=${listId}&card=${c.id}`}
                          scroll={false}
                          aria-label={t.open(c.title)}
                          onPointerEnter={() => prefetchCard(qc, c.id)}
                          onFocus={() => prefetchCard(qc, c.id)}
                          className="font-medium break-words hover:underline"
                        >
                          {c.title}
                        </Link>
                        {labels.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {labels.map((l) => (
                              <span key={l.id} className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${LABEL_CLASS[l.color]}`}>
                                {l.name}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className={TD}>
                        <span
                          className="rounded px-1.5 py-0.5 text-[10px] leading-4 font-bold tracking-wide whitespace-nowrap text-white uppercase"
                          style={{ background: `var(--pb-${c.priority})` }}
                        >
                          {priorityLabel(c.priority, lang)}
                        </span>
                      </td>
                      <td className={TD}>{assignees.length > 0 ? <AvatarStack users={assignees} max={4} /> : <Dash />}</td>
                      <td className={`${TD} whitespace-nowrap text-muted-foreground`}>
                        {c.startDate ? fmtDate(c.startDate, lang) : <Dash />}
                      </td>
                      <td className={`${TD} whitespace-nowrap`}>
                        {c.dueDate ? (
                          <span
                            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 ${
                              overdue
                                ? 'bg-red-100 font-medium text-red-800 dark:bg-red-400/15 dark:text-red-200'
                                : c.completedAt
                                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-200'
                                  : 'text-muted-foreground'
                            }`}
                          >
                            {overdue && <TriangleAlert className="size-3.5" aria-hidden />}
                            {!overdue && c.completedAt && <Check className="size-3.5" aria-hidden />}
                            {overdue ? `${t.overdue} ` : c.completedAt ? <span className="sr-only">{t.completed} </span> : null}
                            {fmtDate(c.dueDate, lang)}
                          </span>
                        ) : (
                          <Dash />
                        )}
                      </td>
                      <td className={`${TD} whitespace-nowrap`}>
                        {c.checklistTotal > 0 ? <Subtasks done={c.checklistDone} total={c.checklistTotal} /> : <Dash />}
                      </td>
                      <td className={`${TD} text-right text-muted-foreground tabular-nums`}>{c.commentCount || <Dash />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Dash() {
  return <span className="text-muted-foreground">–</span>;
}

function Subtasks({ done, total }: { done: number; total: number }) {
  const pct = Math.round((done / total) * 100);
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
        <span className="block h-full rounded-full bg-(--s-done)" style={{ width: `${pct}%` }} />
      </span>
      <span className="text-xs text-muted-foreground tabular-nums">
        {done}/{total}
      </span>
    </span>
  );
}
