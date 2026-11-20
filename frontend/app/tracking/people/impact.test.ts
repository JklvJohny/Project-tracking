import { describe, expect, it } from 'vitest';
import { impactOf, levelOf, spanOf, type Task } from './impact';

const task = (cardId: number, startDate: string | null, dueDate: string | null): Task => ({
  cardId, projectId: 1, projectName: 'P', listName: 'L', title: `Card ${cardId}`, priority: 'medium',
  startDate, dueDate, daysLeft: null, checklistTotal: 0, checklistDone: 0, assignees: [],
});

describe('impactOf', () => {
  const tasks = [
    task(1, '2026-11-15', '2026-11-20'), // overlaps 18-20 (3 days), due inside
    task(2, '2026-11-19', '2026-11-30'), // overlaps 19-24 (6 days)
    task(3, null, '2026-11-10'), // before the window's card span
    task(4, null, null), // no dates: cannot collide
    task(5, '2026-11-21', '2026-11-21'), // one day, inside
  ];
  const card = { from: '2026-11-18', to: '2026-11-24' };

  it('lists the overlapping cards, most shared days first, and flags due dates inside the new card', () => {
    const r = impactOf(tasks, card);
    expect(r.overlaps.map((o) => [o.task.cardId, o.days, o.dueInside])).toEqual([
      [2, 6, false],
      [1, 3, true],
      [5, 1, true],
    ]);
    expect(r.overlaps[0].shared).toEqual({ from: '2026-11-19', to: '2026-11-24' });
  });

  it('counts cards per day before and after, over the card padded by three days', () => {
    const r = impactOf(tasks, card);
    expect(r.window).toEqual({ from: '2026-11-15', to: '2026-11-27' });
    const at = (d: string) => r.load.find((x) => x.day === d)!;
    expect(at('2026-11-15')).toEqual({ day: '2026-11-15', before: 1, after: 1 });
    expect(at('2026-11-19')).toEqual({ day: '2026-11-19', before: 2, after: 3 });
    expect(at('2026-11-21')).toEqual({ day: '2026-11-21', before: 2, after: 3 });
    expect(at('2026-11-25')).toEqual({ day: '2026-11-25', before: 1, after: 1 });
    expect(r.peak?.after).toBe(3);
    expect(r.peak?.day).toBe('2026-11-19');
  });

  it('leaves the card itself out when the person already has it', () => {
    const r = impactOf([...tasks, task(9, '2026-11-18', '2026-11-24')], card, 9);
    expect(r.overlaps.map((o) => o.task.cardId)).not.toContain(9);
  });

  it('caps a very long card at six weeks', () => {
    expect(impactOf([], { from: '2026-01-01', to: '2026-12-31' }).days).toHaveLength(42);
  });
});

describe('helpers', () => {
  it('spanOf uses the one date a card has, and orders reversed dates', () => {
    expect(spanOf({ startDate: null, dueDate: '2026-11-20' })).toEqual({ from: '2026-11-20', to: '2026-11-20' });
    expect(spanOf({ startDate: '2026-11-22', dueDate: '2026-11-20' })).toEqual({ from: '2026-11-20', to: '2026-11-22' });
    expect(spanOf({ startDate: null, dueDate: null })).toBeNull();
  });

  it('levels: 0 free, 1-2 ok, 3 busy, 4+ over', () => {
    expect([0, 1, 2, 3, 4, 7].map(levelOf)).toEqual(['free', 'ok', 'ok', 'busy', 'over', 'over']);
  });
});
