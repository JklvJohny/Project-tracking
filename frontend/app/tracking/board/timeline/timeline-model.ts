import type { components } from '../../shared/api/schema';

type S = components['schemas'];
export type TimelineCard = S['CardSummary'];
export type TimelineStatus = 'done' | 'active' | 'todo' | 'overdue';
export type Range = { start: string; days: number };

export type TimelineRow = {
  card: TimelineCard;
  startPct: number;
  widthPct: number;
  kind: 'bar' | 'milestone';
  status: TimelineStatus;
  /** Real (unclipped) span, for labels. */
  from: string;
  to: string;
};
export type TimelineGroup = { assignee: S['User'] | null; rows: TimelineRow[] };
export type Timeline = {
  groups: TimelineGroup[];
  /** `label` is the week's Monday as YYYY-MM-DD; the view formats it for the language. */
  weeks: { label: string; leftPct: number }[];
  todayPct: number | null;
  undated: TimelineCard[];
  /** Dated cards that fall wholly outside the range. */
  outside: number;
};

const DAY_MS = 864e5;
// Dates are plain YYYY-MM-DD: do all arithmetic at UTC midnight so DST and the viewer's zone cannot shift a day.
const toDay = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / DAY_MS;
const fromDay = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);

export const addDays = (iso: string, n: number) => fromDay(toDay(iso) + n);
export const daysBetween = (a: string, b: string) => toDay(b) - toDay(a);

/** Monday of the week containing `iso`. */
export function mondayOf(iso: string): string {
  const dow = new Date(toDay(iso) * DAY_MS).getUTCDay(); // 0 = Sunday
  return addDays(iso, -((dow + 6) % 7));
}

export const defaultRange = (today: string): Range => ({ start: mondayOf(today), days: 28 });

function statusOf(c: TimelineCard, today: string): TimelineStatus {
  if (c.completedAt) return 'done';
  if (c.dueDate && c.dueDate < today) return 'overdue';
  if (c.startDate && c.startDate <= today) return 'active';
  return 'todo';
}

export function buildTimeline(
  board: { cards: TimelineCard[]; users: S['User'][] },
  range: Range,
  today: string,
): Timeline {
  const end = addDays(range.start, range.days - 1);
  const pct = (n: number) => (n / range.days) * 100;
  const byAssignee = new Map<number | null, TimelineRow[]>();
  const undated: TimelineCard[] = [];
  let outside = 0;

  for (const card of board.cards) {
    const from = card.startDate ?? card.dueDate;
    const to = card.dueDate ?? card.startDate;
    if (!from || !to) {
      undated.push(card);
      continue;
    }
    if (to < range.start || from > end) {
      outside++;
      continue;
    }
    const first = Math.max(0, daysBetween(range.start, from));
    const last = Math.min(range.days - 1, daysBetween(range.start, to));
    const row: TimelineRow = {
      card,
      startPct: pct(first),
      widthPct: pct(last - first + 1),
      kind: from === to ? 'milestone' : 'bar',
      status: statusOf(card, today),
      from,
      to,
    };
    for (const id of card.assigneeIds.length ? card.assigneeIds : [null]) {
      byAssignee.set(id, [...(byAssignee.get(id) ?? []), row]);
    }
  }

  const sortRows = (rows: TimelineRow[]) => [...rows].sort((a, b) => a.from.localeCompare(b.from) || a.card.id - b.card.id);
  const groups: TimelineGroup[] = [];
  for (const user of board.users) {
    const rows = byAssignee.get(user.id);
    if (rows) groups.push({ assignee: user, rows: sortRows(rows) });
  }
  const none = byAssignee.get(null);
  if (none) groups.push({ assignee: null, rows: sortRows(none) });

  const weeks = [];
  for (let d = 0; d < range.days; d += 7) weeks.push({ label: addDays(range.start, d), leftPct: pct(d) });
  const todayOff = daysBetween(range.start, today);
  return {
    groups,
    weeks,
    todayPct: todayOff >= 0 && todayOff < range.days ? pct(todayOff + 0.5) : null,
    undated,
    outside,
  };
}
