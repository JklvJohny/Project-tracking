import { describe, expect, it } from 'vitest';
import type { components } from '../../shared/api/schema';
import { addDays, buildTimeline, defaultRange, mondayOf } from './timeline-model';

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
const users: S['User'][] = [
  { id: 1, name: 'Ann', avatarUrl: '' },
  { id: 2, name: 'Bob', avatarUrl: '' },
];
const board = (cards: S['CardSummary'][]) => ({ cards, users });
// 28-day range Mon 2026-11-02 .. Sun 2026-11-29
const range = { start: '2026-11-02', days: 28 };
const TODAY = '2026-11-18';

describe('date helpers', () => {
  it('adds days across month ends without local-time drift', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('finds the Monday of a week', () => {
    expect(mondayOf('2026-11-18')).toBe('2026-11-16');
    expect(mondayOf('2026-11-22')).toBe('2026-11-16');
    expect(mondayOf('2026-11-16')).toBe('2026-11-16');
  });
  it('default range is 4 weeks starting at this week', () => {
    expect(defaultRange(TODAY)).toEqual({ start: '2026-11-16', days: 28 });
  });
});

describe('buildTimeline', () => {
  it('places a bar by percentage of the range', () => {
    const m = buildTimeline(board([card({ id: 1, assigneeIds: [1], startDate: '2026-11-09', dueDate: '2026-11-22' })]), range, TODAY);
    const row = m.groups[0].rows[0];
    expect(m.groups[0].assignee?.name).toBe('Ann');
    expect(row.kind).toBe('bar');
    expect(row.startPct).toBeCloseTo((7 / 28) * 100);
    expect(row.widthPct).toBeCloseTo((14 / 28) * 100);
    expect(row.status).toBe('active');
  });
  it('single-date and same-day cards are milestones one day wide', () => {
    const m = buildTimeline(
      board([
        card({ id: 1, assigneeIds: [1], dueDate: '2026-11-20' }),
        card({ id: 2, assigneeIds: [1], startDate: '2026-11-21', dueDate: '2026-11-21' }),
      ]),
      range,
      TODAY,
    );
    const rows = m.groups[0].rows;
    expect(rows.map((r) => r.kind)).toEqual(['milestone', 'milestone']);
    expect(rows[0].widthPct).toBeCloseTo((1 / 28) * 100);
    expect(rows[0].status).toBe('todo');
  });
  it('past-due unfinished is overdue, completed is done even when late', () => {
    const m = buildTimeline(
      board([
        card({ id: 1, assigneeIds: [1], startDate: '2026-11-03', dueDate: '2026-11-10' }),
        card({ id: 2, assigneeIds: [1], startDate: '2026-11-03', dueDate: '2026-11-10', completedAt: '2026-11-12T00:00:00Z' }),
      ]),
      range,
      TODAY,
    );
    expect(m.groups[0].rows.map((r) => r.status)).toEqual(['overdue', 'done']);
  });
  it('future start is todo', () => {
    const m = buildTimeline(board([card({ id: 1, assigneeIds: [1], startDate: '2026-11-25', dueDate: '2026-11-27' })]), range, TODAY);
    expect(m.groups[0].rows[0].status).toBe('todo');
  });
  it('clips bars that overhang the range and drops ones fully outside', () => {
    const m = buildTimeline(
      board([
        card({ id: 1, assigneeIds: [1], startDate: '2026-10-25', dueDate: '2026-11-04' }),
        card({ id: 2, assigneeIds: [1], startDate: '2026-11-27', dueDate: '2026-12-10' }),
        card({ id: 3, assigneeIds: [1], startDate: '2026-12-20', dueDate: '2026-12-22' }),
        card({ id: 4, assigneeIds: [1], startDate: '2026-10-01', dueDate: '2026-10-02' }),
      ]),
      range,
      TODAY,
    );
    const [a, b] = m.groups[0].rows;
    expect(m.groups[0].rows).toHaveLength(2);
    expect(a.startPct).toBe(0);
    expect(a.widthPct).toBeCloseTo((3 / 28) * 100);
    expect(b.startPct + b.widthPct).toBeCloseTo(100);
    expect(m.outside).toBe(2);
  });
  it('lists cards with no dates as undated and keeps them off the grid', () => {
    const m = buildTimeline(board([card({ id: 1, assigneeIds: [1] })]), range, TODAY);
    expect(m.undated.map((c) => c.id)).toEqual([1]);
    expect(m.groups).toEqual([]);
  });
  it('puts a multi-assignee card in each assignee group and unassigned last', () => {
    const m = buildTimeline(
      board([
        card({ id: 1, assigneeIds: [2, 1], startDate: '2026-11-05', dueDate: '2026-11-06' }),
        card({ id: 2, startDate: '2026-11-04', dueDate: '2026-11-05' }),
      ]),
      range,
      TODAY,
    );
    expect(m.groups.map((g) => g.assignee?.name ?? null)).toEqual(['Ann', 'Bob', null]);
    expect(m.groups[0].rows[0].card.id).toBe(1);
    expect(m.groups[1].rows[0].card.id).toBe(1);
  });
  it('sorts rows by start date', () => {
    const m = buildTimeline(
      board([
        card({ id: 1, assigneeIds: [1], startDate: '2026-11-10', dueDate: '2026-11-12' }),
        card({ id: 2, assigneeIds: [1], startDate: '2026-11-03', dueDate: '2026-11-05' }),
      ]),
      range,
      TODAY,
    );
    expect(m.groups[0].rows.map((r) => r.card.id)).toEqual([2, 1]);
  });
  it('gives week ticks and a today marker only when today is in range', () => {
    const m = buildTimeline(board([]), range, TODAY);
    expect(m.weeks.map((w) => w.label)).toEqual(['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23']);
    expect(m.weeks[1].leftPct).toBeCloseTo(25);
    expect(m.todayPct).toBeCloseTo(((16 + 0.5) / 28) * 100);
    expect(buildTimeline(board([]), range, '2027-01-01').todayPct).toBeNull();
  });
});
