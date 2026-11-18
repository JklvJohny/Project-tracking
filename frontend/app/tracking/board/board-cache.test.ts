import { describe, expect, it } from 'vitest';
import type { components } from '../shared/api/schema';
import { cardsByList, bumpCommentCount, detailToSummary, moveCardLocal, setListCompletion, moveListLocal, removeCard, upsertCard, upsertList, type BoardData } from './board-cache';

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
  checklistPreview: [],
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

describe('setListCompletion', () => {
  it('stamps only cards without completedAt; false clears all; other lists untouched', () => {
    const b = board([card(1, 1), card(2, 1, { completedAt: '2026-01-01T00:00:00Z' }), card(3, 2)]);
    const done = setListCompletion(b, 1, '2026-11-17T10:00:00Z');
    expect(done.cards.map((c) => c.completedAt)).toEqual(['2026-11-17T10:00:00Z', '2026-01-01T00:00:00Z', null]);
    expect(setListCompletion(done, 1, null).cards.map((c) => c.completedAt)).toEqual([null, null, null]);
  });
});

describe('detailToSummary', () => {
  const detail = {
    id: 9, createdBy: 2, listId: 1, title: 't', descriptionMd: '', priority: 'low' as const, startDate: null, dueDate: null,
    position: 'p', completedAt: null, createdAt: 'x', updatedAt: 'y', archivedAt: null, assigneeIds: [1], labelIds: [2],
    checklist: [
      { id: 1, text: 'a', isDone: true, position: 'a' },
      { id: 2, text: 'b', isDone: false, position: 'b' },
    ],
  };
  it('counts checklist and takes commentCount from prev', () => {
    const s = detailToSummary(detail, card(9, 1, { commentCount: 4 }));
    expect([s.checklistTotal, s.checklistDone, s.commentCount]).toEqual([2, 1, 4]);
    expect(detailToSummary(detail).commentCount).toBe(0);
  });
});

describe('bumpCommentCount', () => {
  const b = { cards: [card(1, 1, { commentCount: 1 }), card(2, 1, { commentCount: 0 })] } as unknown as BoardData;
  it('adds to one card and never goes below zero', () => {
    expect(bumpCommentCount(b, 1, 1).cards.map((c) => c.commentCount)).toEqual([2, 0]);
    expect(bumpCommentCount(b, 2, -1).cards.map((c) => c.commentCount)).toEqual([1, 0]);
  });
  it('ignores an unknown card', () => {
    expect(bumpCommentCount(b, 9, 1)).toBe(b);
  });
});

describe('setPreviewItemDone', () => {
  const card = {
    id: 5, listId: 1, title: 't', priority: 'low', startDate: null, dueDate: null, position: 'a', completedAt: null,
    updatedAt: 'x', labelIds: [], assigneeIds: [], checklistTotal: 4, checklistDone: 1, commentCount: 0,
    checklistPreview: [{ id: 1, text: 'a', isDone: true }, { id: 2, text: 'b', isDone: false }],
  } as const;
  const b = { cards: [card] } as unknown as import('./board-cache').BoardData;
  it('flips the item and the done count, and is a no-op when unchanged', async () => {
    const { setPreviewItemDone } = await import('./board-cache');
    const on = setPreviewItemDone(b, 5, 2, true).cards[0];
    expect(on.checklistDone).toBe(2);
    expect(on.checklistPreview[1].isDone).toBe(true);
    expect(setPreviewItemDone(b, 5, 1, true)).toEqual(b);
    expect(setPreviewItemDone(b, 5, 1, false).cards[0].checklistDone).toBe(0);
  });
});
