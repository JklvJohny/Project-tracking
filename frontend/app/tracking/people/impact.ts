import type { components } from '../shared/api/schema';
import { addDays } from '../board/timeline/timeline-model';

export type Task = components['schemas']['Task'];
export type Span = { from: string; to: string };

/** A day with this many open cards at once is busy; at OVERLOADED or more it is too many. */
export const BUSY = 3;
export const OVERLOADED = 4;
/** Days shown either side of the new card, so what leads into it and follows it is in view. */
export const PAD_DAYS = 3;
/** The longest window drawn; a longer card is shown from its start. */
export const MAX_DAYS = 42;

export type Level = 'free' | 'ok' | 'busy' | 'over';
export const levelOf = (n: number): Level => (n === 0 ? 'free' : n >= OVERLOADED ? 'over' : n >= BUSY ? 'busy' : 'ok');

/** A card's days: start to due, or the one date it has; null without dates. */
export function spanOf(x: { startDate: string | null; dueDate: string | null }): Span | null {
  const from = x.startDate ?? x.dueDate;
  const to = x.dueDate ?? x.startDate;
  if (!from || !to) return null;
  return from <= to ? { from, to } : { from: to, to: from };
}

const maxIso = (a: string, b: string) => (a > b ? a : b);
const minIso = (a: string, b: string) => (a < b ? a : b);

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5);
}

export type Overlap = { task: Task; span: Span; shared: Span; days: number; dueInside: boolean };
export type DayLoad = { day: string; before: number; after: number };
export type Impact = {
  window: Span;
  days: string[];
  card: Span;
  overlaps: Overlap[];
  load: DayLoad[];
  /** The heaviest day inside the card's span, after adding it. */
  peak: DayLoad | null;
};

/**
 * What giving a card spanning `card` to someone does to their schedule, by dates alone (cards carry no effort):
 * the open cards it overlaps, and per day how many cards they hold before and after. `cardId` (the card itself,
 * if they already have it) is left out so it is not counted twice.
 */
export function impactOf(tasks: Task[], card: Span, cardId?: number): Impact {
  const from = addDays(card.from, -PAD_DAYS);
  const to = minIso(addDays(card.to, PAD_DAYS), addDays(from, MAX_DAYS - 1));
  const days = Array.from({ length: daysBetween(from, to) + 1 }, (_, i) => addDays(from, i));
  const dated = tasks
    .filter((t) => t.cardId !== cardId)
    .flatMap((task) => {
      const span = spanOf(task);
      return span ? [{ task, span }] : [];
    });
  const overlaps: Overlap[] = dated
    .filter(({ span }) => span.from <= card.to && span.to >= card.from)
    .map(({ task, span }) => {
      const shared = { from: maxIso(span.from, card.from), to: minIso(span.to, card.to) };
      return { task, span, shared, days: daysBetween(shared.from, shared.to) + 1, dueInside: !!task.dueDate && task.dueDate >= card.from && task.dueDate <= card.to };
    })
    // Most entangled first: the most shared days, then the earliest due.
    .sort((a, b) => b.days - a.days || (a.task.dueDate ?? '9').localeCompare(b.task.dueDate ?? '9'));
  const load = days.map((day) => {
    const before = dated.filter(({ span }) => span.from <= day && span.to >= day).length;
    return { day, before, after: before + (day >= card.from && day <= card.to ? 1 : 0) };
  });
  const inside = load.filter((d) => d.day >= card.from && d.day <= card.to);
  const peak = inside.reduce<DayLoad | null>((best, d) => (!best || d.after > best.after ? d : best), null);
  return { window: { from, to }, days, card, overlaps, load, peak };
}
