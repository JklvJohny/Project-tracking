import { describe, expect, it } from 'vitest';
import type { components } from '../../shared/api/schema';
import { addMonths, buildMonth, parseMonth, weekCount } from './calendar-model';

type S = components['schemas'];
const card = (over: Partial<S['CardSummary']> & { id: number }): S['CardSummary'] => ({
  listId: 1,
  title: `c${over.id}`,
  priority: 'medium',
  startDate: null,
  dueDate: null,
  position: 'a',
  completedAt: null,
  updatedAt: 'x',
  labelIds: [],
  assigneeIds: [],
  checklistTotal: 0,
  checklistDone: 0,
  commentCount: 0,
  checklistPreview: [],
  ...over,
});
const TODAY = '2026-11-18';

describe('month helpers', () => {
  it('parses ?month= and falls back to the current month', () => {
    expect(parseMonth('2026-02', TODAY)).toBe('2026-02');
    expect(parseMonth('2026-13', TODAY)).toBe('2026-11');
    expect(parseMonth(null, TODAY)).toBe('2026-11');
  });
  it('counts the rows a month needs, Monday-first', () => {
    expect([weekCount('2026-11'), weekCount('2026-12'), weekCount('2027-02')]).toEqual([6, 5, 4]);
  });
  it('steps across year ends', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
  });
});

describe('buildMonth', () => {
  it('lays November 2026 out Monday-first in 6 weeks, with days outside the month marked', () => {
    const m = buildMonth([], '2026-11', TODAY);
    expect(m.weeks).toHaveLength(6);
    expect(m.weeks[0].days[0]).toMatchObject({ iso: '2026-10-26', inMonth: false });
    expect(m.weeks[5].days[6]).toMatchObject({ iso: '2026-12-06', inMonth: false });
    expect(m.weeks[3].days.find((d) => d.today)?.iso).toBe(TODAY);
  });

  it('splits a card that crosses a week into one bar per week, open at the cut ends', () => {
    const m = buildMonth([card({ id: 1, startDate: '2026-11-13', dueDate: '2026-11-19' })], '2026-11', TODAY);
    const [a] = m.weeks[2].bars; // week of Mon 9th
    const [b] = m.weeks[3].bars; // week of Mon 16th
    expect(a).toMatchObject({ col: 4, span: 3, startsBefore: false, endsAfter: true });
    expect(b).toMatchObject({ col: 0, span: 4, startsBefore: true, endsAfter: false, status: 'active' });
  });

  it('packs non-overlapping cards into one lane and counts the overflow per day', () => {
    const cards = [
      card({ id: 1, dueDate: '2026-11-16' }),
      card({ id: 2, dueDate: '2026-11-17' }),
      card({ id: 3, startDate: '2026-11-16', dueDate: '2026-11-18' }),
    ];
    const w = buildMonth(cards, '2026-11', TODAY).weeks[3];
    const lane = (id: number) => w.bars.find((b) => b.card.id === id)?.lane;
    // The longer card takes the top lane; the two one-day cards share the next one.
    expect([lane(3), lane(1), lane(2)]).toEqual([0, 1, 1]);
    expect(w.days[0].cards.map((c) => c.id)).toEqual([3, 1]);

    const tight = buildMonth(cards, '2026-11', TODAY, 1).weeks[3];
    expect(tight.bars.map((b) => b.card.id)).toEqual([3]);
    expect(tight.days.slice(0, 3).map((d) => d.hidden)).toEqual([1, 1, 0]);
  });

  it('builds the agenda from cards touching the month and lists undated ones apart', () => {
    const m = buildMonth(
      [
        card({ id: 1, startDate: '2026-10-28', dueDate: '2026-11-03' }),
        card({ id: 2, dueDate: '2026-11-20', completedAt: '2026-11-19T00:00:00Z' }),
        card({ id: 3, dueDate: '2026-12-02' }),
        card({ id: 4 }),
      ],
      '2026-11',
      TODAY,
    );
    expect(m.agenda.map((a) => [a.card.id, a.first, a.status])).toEqual([
      [1, '2026-11-01', 'overdue'],
      [2, '2026-11-20', 'done'],
    ]);
    expect(m.undated.map((c) => c.id)).toEqual([4]);
  });
});
