import { describe, expect, it } from 'vitest';
import type { components } from '../shared/api/schema';
import { cardsByList, moveCardLocal, moveListLocal, removeCard, upsertCard, upsertList, type BoardData } from './board-cache';

type Card = components['schemas']['CardSummary'];

const card = (id: number, listId: number, extra: Partial<Card> = {}): Card => ({
  id,
  listId,
  title: `c${id}`,
  priority: 'medium',
  startDate: null,
  dueDate: null,
  position: String(id),
  completedAt: null,
  updatedAt: '2026-11-17T00:00:00Z',
  labelIds: [],
  assigneeIds: [],
  checklistTotal: 0,
  checklistDone: 0,
  commentCount: 0,
  ...extra,
});
const list = (id: number) => ({ id, boardId: 1, name: `l${id}`, position: String(id), isDone: false, wipLimit: null, archivedAt: null });

function board(cards: Card[], lists = [list(1), list(2), list(3)]): BoardData {
  return {
    board: { id: 1, projectId: 1, updatedAt: '2026-11-17T00:00:00Z' },
    project: {} as BoardData['project'],
    myRole: 'pm',
    lists,
    cards,
    labels: [],
    members: [],
    users: [],
  };
}
const ids = (b: BoardData, listId: number) => cardsByList(b).get(listId)!.map((c) => c.id);

describe('moveCardLocal', () => {
  it('places card between neighbours in target list', () => {
    const b = board([card(1, 1), card(2, 1), card(3, 2), card(4, 2), card(5, 2)]);
    const next = moveCardLocal(b, { cardId: 1, toListId: 2, beforeId: 3, afterId: 4 });
    expect(ids(next, 2)).toEqual([3, 1, 4, 5]);
    expect(ids(next, 1)).toEqual([2]);
    expect(next.cards.find((c) => c.id === 1)!.listId).toBe(2);
    expect(ids(b, 1)).toEqual([1, 2]); // input not mutated
  });

  it('moves within the same list', () => {
    const b = board([card(1, 1), card(2, 1), card(3, 1)]);
    expect(ids(moveCardLocal(b, { cardId: 1, toListId: 1, beforeId: 2, afterId: 3 }), 1)).toEqual([2, 1, 3]);
  });

  it('to empty list', () => {
    const b = board([card(1, 1), card(2, 1)]);
    const next = moveCardLocal(b, { cardId: 2, toListId: 3, beforeId: null, afterId: null });
    expect(ids(next, 3)).toEqual([2]);
    expect(ids(next, 1)).toEqual([1]);
  });

  it('goes to the top when only afterId, to the end when only beforeId', () => {
    const b = board([card(1, 1), card(2, 2), card(3, 2)]);
    expect(ids(moveCardLocal(b, { cardId: 1, toListId: 2, beforeId: null, afterId: 2 }), 2)).toEqual([1, 2, 3]);
    expect(ids(moveCardLocal(b, { cardId: 1, toListId: 2, beforeId: 3, afterId: null }), 2)).toEqual([2, 3, 1]);
  });

  it('returns the board unchanged for an unknown card', () => {
    const b = board([card(1, 1)]);
    expect(moveCardLocal(b, { cardId: 99, toListId: 2, beforeId: null, afterId: null })).toBe(b);
  });
});

describe('upsertCard / removeCard', () => {
  it('upsertCard replaces by id without reordering others', () => {
    const b = board([card(1, 1), card(2, 1), card(3, 1)]);
    const next = upsertCard(b, card(2, 1, { title: 'renamed' }));
    expect(next.cards.map((c) => c.id)).toEqual([1, 2, 3]);
    expect(next.cards[1].title).toBe('renamed');
  });

  it('upsertCard appends a new card and ignores cards of unknown lists', () => {
    const b = board([card(1, 1)]);
    expect(upsertCard(b, card(2, 1)).cards.map((c) => c.id)).toEqual([1, 2]);
    expect(upsertCard(b, card(3, 77))).toBe(b);
  });

  it('removeCard drops the card', () => {
    const b = board([card(1, 1), card(2, 1)]);
    expect(removeCard(b, 1).cards.map((c) => c.id)).toEqual([2]);
  });
});

describe('lists', () => {
  it('upsertList replaces by id and appends new; archived lists leave the board with their cards', () => {
    const b = board([card(1, 1), card(2, 2)]);
    expect(upsertList(b, { ...list(2), name: 'x' }).lists.map((l) => l.name)).toEqual(['l1', 'x', 'l3']);
    expect(upsertList(b, list(4)).lists.map((l) => l.id)).toEqual([1, 2, 3, 4]);
    const gone = upsertList(b, { ...list(1), archivedAt: '2026-11-17T00:00:00Z' });
    expect(gone.lists.map((l) => l.id)).toEqual([2, 3]);
    expect(gone.cards.map((c) => c.id)).toEqual([2]);
  });

  it('moveListLocal places list between neighbours', () => {
    const b = board([]);
    expect(moveListLocal(b, { listId: 1, beforeId: 2, afterId: 3 }).lists.map((l) => l.id)).toEqual([2, 1, 3]);
    expect(moveListLocal(b, { listId: 3, beforeId: null, afterId: 1 }).lists.map((l) => l.id)).toEqual([3, 1, 2]);
  });

  it('cardsByList includes empty lists', () => {
    expect([...cardsByList(board([card(1, 2)])).keys()]).toEqual([1, 2, 3]);
  });
});
