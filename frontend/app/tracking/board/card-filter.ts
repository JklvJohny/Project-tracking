import type { CardSummary } from './board-cache';
import type { Priority } from '../shared/format';

export type DueFilter = 'overdue' | 'week' | 'none';

/**
 * Board card filter. Within one field the choices are OR (any picked assignee); across fields they are AND.
 * `assignees` holds user ids, with 0 meaning "nobody assigned".
 */
export type CardFilter = {
  q: string;
  assignees: number[];
  labels: number[];
  priorities: Priority[];
  due: DueFilter[];
};

export const EMPTY_FILTER: CardFilter = { q: '', assignees: [], labels: [], priorities: [], due: [] };

export const isFiltering = (f: CardFilter) =>
  f.q.trim() !== '' || f.assignees.length > 0 || f.labels.length > 0 || f.priorities.length > 0 || f.due.length > 0;

/** YYYY-MM-DD plus n days, in UTC so the plain date never shifts. */
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function dueMatches(c: CardSummary, due: DueFilter[], today: string): boolean {
  return due.some((d) => {
    if (d === 'none') return !c.dueDate;
    if (!c.dueDate || c.completedAt) return false;
    if (d === 'overdue') return c.dueDate < today;
    return c.dueDate >= today && c.dueDate <= addDays(today, 7);
  });
}

export function matchesFilter(c: CardSummary, f: CardFilter, today: string): boolean {
  const q = f.q.trim().toLocaleLowerCase();
  if (q && !c.title.toLocaleLowerCase().includes(q)) return false;
  if (f.assignees.length && !f.assignees.some((id) => (id === 0 ? c.assigneeIds.length === 0 : c.assigneeIds.includes(id))))
    return false;
  if (f.labels.length && !f.labels.some((id) => c.labelIds.includes(id))) return false;
  if (f.priorities.length && !f.priorities.includes(c.priority)) return false;
  if (f.due.length && !dueMatches(c, f.due, today)) return false;
  return true;
}
