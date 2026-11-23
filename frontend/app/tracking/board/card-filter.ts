import { createContext, useContext } from 'react';
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

// The filter lives in the URL, so a reload or a shared link shows the same cards. Short keys, comma lists.
export const FILTER_KEYS = ['q', 'who', 'label', 'priority', 'due'] as const;
const PRIORITIES: readonly Priority[] = ['low', 'medium', 'high', 'urgent'];
const DUES: readonly DueFilter[] = ['overdue', 'week', 'none'];

const ids = (v: string | null) =>
  (v ?? '').split(',').filter(Boolean).map(Number).filter((n) => Number.isInteger(n) && n >= 0);
const oneOf = <T extends string>(v: string | null, allowed: readonly T[]) =>
  (v ?? '').split(',').filter((x): x is T => (allowed as readonly string[]).includes(x));

/** Reads a filter from the query; anything unknown or malformed is dropped, not an error. */
export function filterFromQuery(sp: { get(k: string): string | null }): CardFilter {
  return {
    q: sp.get('q') ?? '',
    assignees: ids(sp.get('who')),
    labels: ids(sp.get('label')),
    priorities: oneOf(sp.get('priority'), PRIORITIES),
    due: oneOf(sp.get('due'), DUES),
  };
}

/** The filter as query parameters; an empty part is left out, so no filter is no parameter at all. */
export function filterToQuery(f: CardFilter): URLSearchParams {
  const out = new URLSearchParams();
  if (f.q.trim()) out.set('q', f.q);
  if (f.assignees.length) out.set('who', f.assignees.join(','));
  if (f.labels.length) out.set('label', f.labels.join(','));
  if (f.priorities.length) out.set('priority', f.priorities.join(','));
  if (f.due.length) out.set('due', f.due.join(','));
  return out;
}

/** The board's filter as a query string, for links that open a card or a list without dropping the filter. */
export const FilterQuery = createContext('');

/** An href on the board page that keeps the filter and adds one parameter (`card` or `list`). */
export function useBoardHref(pathname: string, key: 'card' | 'list', id: number): string {
  const filter = useContext(FilterQuery);
  return `${pathname}?${filter ? `${filter}&` : ''}${key}=${id}`;
}

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
