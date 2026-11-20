import { describe, expect, it } from 'vitest';
import type { CardSummary } from './board-cache';
import { EMPTY_FILTER, isFiltering, matchesFilter, type CardFilter } from './card-filter';

const card = (over: Partial<CardSummary>): CardSummary => ({
  id: 1, listId: 1, title: 'Fix Login page', priority: 'high', startDate: null, dueDate: null, position: 'a',
  completedAt: null, updatedAt: 'x', labelIds: [], assigneeIds: [], checklistTotal: 0, checklistDone: 0, commentCount: 0,
  checklistPreview: [], ...over,
});
const today = '2026-11-20';
const f = (over: Partial<CardFilter>): CardFilter => ({ ...EMPTY_FILTER, ...over });

describe('card filter', () => {
  it('is inactive when empty or only spaces are typed', () => {
    expect(isFiltering(EMPTY_FILTER)).toBe(false);
    expect(isFiltering(f({ q: '   ' }))).toBe(false);
    expect(isFiltering(f({ due: ['none'] }))).toBe(true);
  });

  it('searches the title, ignoring case', () => {
    expect(matchesFilter(card({}), f({ q: 'login' }), today)).toBe(true);
    expect(matchesFilter(card({}), f({ q: 'logout' }), today)).toBe(false);
  });

  it('ORs within a field and ANDs across fields; 0 is "nobody assigned"', () => {
    const a = card({ assigneeIds: [2], labelIds: [9] });
    expect(matchesFilter(a, f({ assignees: [3, 2] }), today)).toBe(true);
    expect(matchesFilter(a, f({ assignees: [2], labels: [8] }), today)).toBe(false);
    expect(matchesFilter(card({}), f({ assignees: [0] }), today)).toBe(true);
    expect(matchesFilter(a, f({ assignees: [0] }), today)).toBe(false);
  });

  it('due: overdue and next 7 days skip completed cards; none means no due date', () => {
    expect(matchesFilter(card({ dueDate: '2026-11-19' }), f({ due: ['overdue'] }), today)).toBe(true);
    expect(matchesFilter(card({ dueDate: '2026-11-19', completedAt: 'x' }), f({ due: ['overdue'] }), today)).toBe(false);
    expect(matchesFilter(card({ dueDate: '2026-11-27' }), f({ due: ['week'] }), today)).toBe(true);
    expect(matchesFilter(card({ dueDate: '2026-11-28' }), f({ due: ['week'] }), today)).toBe(false);
    expect(matchesFilter(card({}), f({ due: ['none'] }), today)).toBe(true);
    expect(matchesFilter(card({ dueDate: '2026-11-28' }), f({ due: ['none', 'week'] }), today)).toBe(false);
  });

  it('filters by priority', () => {
    expect(matchesFilter(card({}), f({ priorities: ['low', 'high'] }), today)).toBe(true);
    expect(matchesFilter(card({}), f({ priorities: ['urgent'] }), today)).toBe(false);
  });
});
