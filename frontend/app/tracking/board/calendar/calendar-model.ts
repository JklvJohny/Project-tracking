import { addDays, daysBetween, mondayOf, statusOf, type TimelineCard, type TimelineStatus } from '../timeline/timeline-model';

export type CalendarBar = {
  card: TimelineCard;
  /** 0 = Monday. */
  col: number;
  span: number;
  lane: number;
  status: TimelineStatus;
  /** Real (unclipped) span, for labels. */
  from: string;
  to: string;
  /** The card runs on from the previous week / into the next one, so that end is drawn open. */
  startsBefore: boolean;
  endsAfter: boolean;
};
export type CalendarDay = {
  iso: string;
  inMonth: boolean;
  today: boolean;
  /** Every card on this day, earliest first; the "+n" popover lists them all. */
  cards: TimelineCard[];
  /** How many of them have no visible lane in this week. */
  hidden: number;
};
export type CalendarWeek = { days: CalendarDay[]; bars: CalendarBar[] };
export type CalendarMonth = {
  /** YYYY-MM */
  month: string;
  weeks: CalendarWeek[];
  /** Dated cards that touch the month, earliest first, for the phone agenda. */
  agenda: { first: string; card: TimelineCard; from: string; to: string; status: TimelineStatus }[];
  undated: TimelineCard[];
};

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** `param` when it is a valid YYYY-MM, else the month of `today`. */
export function parseMonth(param: string | null, today: string): string {
  return param && MONTH.test(param) ? param : today.slice(0, 7);
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const i = y * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}

function lastDayOf(month: string): string {
  return addDays(`${addMonths(month, 1)}-01`, -1);
}

const span = (c: TimelineCard) => {
  const from = c.startDate ?? c.dueDate;
  const to = c.dueDate ?? c.startDate;
  // A due date before the start is bad data; draw it on the start day rather than not at all.
  return from && to ? { from, to: to < from ? from : to } : null;
};

/**
 * Lays the month out Monday-first, 4 to 6 weeks. Each week packs its cards into lanes (earliest, then longest,
 * first) so a multi-day card is one bar across its days; lanes past `lanes` are counted per day as "+n".
 */
export function buildMonth(cards: TimelineCard[], month: string, today: string, lanes = 4): CalendarMonth {
  const first = `${month}-01`;
  const last = lastDayOf(month);
  const dated = cards
    .map((card) => ({ card, ...span(card)! }))
    .filter((x) => x.from)
    .sort((a, b) => a.from.localeCompare(b.from) || daysBetween(b.from, b.to) - daysBetween(a.from, a.to) || a.card.id - b.card.id);

  const weeks: CalendarWeek[] = [];
  for (let start = mondayOf(first); start <= last; start = addDays(start, 7)) {
    const end = addDays(start, 6);
    const free: string[] = []; // last day taken in each lane
    const bars: CalendarBar[] = [];
    const hiddenOn = new Map<string, number>();
    for (const x of dated) {
      if (x.to < start || x.from > end) continue;
      const a = x.from < start ? start : x.from;
      const b = x.to > end ? end : x.to;
      let lane = free.findIndex((taken) => taken < a);
      if (lane === -1) lane = free.push(b) - 1;
      else free[lane] = b;
      if (lane >= lanes) {
        for (let d = a; d <= b; d = addDays(d, 1)) hiddenOn.set(d, (hiddenOn.get(d) ?? 0) + 1);
        continue;
      }
      bars.push({
        card: x.card,
        col: daysBetween(start, a),
        span: daysBetween(a, b) + 1,
        lane,
        status: statusOf(x.card, today),
        from: x.from,
        to: x.to,
        startsBefore: x.from < start,
        endsAfter: x.to > end,
      });
    }
    const days: CalendarDay[] = [];
    for (let i = 0; i < 7; i++) {
      const iso = addDays(start, i);
      days.push({
        iso,
        inMonth: iso.startsWith(month),
        today: iso === today,
        cards: dated.filter((x) => x.from <= iso && x.to >= iso).map((x) => x.card),
        hidden: hiddenOn.get(iso) ?? 0,
      });
    }
    weeks.push({ days, bars });
  }

  const agenda = dated
    .filter((x) => x.to >= first && x.from <= last)
    .map((x) => ({ first: x.from < first ? first : x.from, card: x.card, from: x.from, to: x.to, status: statusOf(x.card, today) }));
  return { month, weeks, agenda, undated: cards.filter((c) => !span(c)) };
}
