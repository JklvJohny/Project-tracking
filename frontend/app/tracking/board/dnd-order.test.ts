import { describe, expect, it } from 'vitest';
import { containerOf, dropOrder, neighboursAt, previewCrossList, type Preview } from './dnd-order';

const start = (): Preview =>
  new Map([
    [1, [10, 11, 12]],
    [2, [20, 21]],
    [3, []],
  ]);

describe('neighboursAt', () => {
  it('excludes the dragged item', () => {
    expect(neighboursAt([1, 9, 2], 9)).toEqual({ beforeId: 1, afterId: 2 });
    expect(neighboursAt([9, 2], 9)).toEqual({ beforeId: null, afterId: 2 });
    expect(neighboursAt([1, 9], 9)).toEqual({ beforeId: 1, afterId: null });
    expect(neighboursAt([9], 9)).toEqual({ beforeId: null, afterId: null });
  });
});

/** Drag card 10 to over, then drop on dropOver (defaults to the same target) and return what the server gets. */
function drag(cardId: number, overId: string, below = false, dropOver = overId) {
  const a = `card:${cardId}`;
  const p = previewCrossList(start(), a, overId, below);
  const end = dropOrder(p, a, dropOver)!;
  return { listId: end.listId, ...neighboursAt(end.ids, cardId) };
}

describe('pointer path', () => {
  it('drop into an empty list', () => {
    expect(drag(10, 'list-drop:3')).toEqual({ listId: 3, beforeId: null, afterId: null });
  });
  it('cross-list to the top and to the bottom of a list', () => {
    // After crossing, the card sits in its slot, so the drop's `over` is the card itself.
    expect(drag(10, 'card:20', false, 'card:10')).toEqual({ listId: 2, beforeId: null, afterId: 20 });
    expect(drag(10, 'card:21', true, 'card:10')).toEqual({ listId: 2, beforeId: 21, afterId: null });
  });
  it('cross-list onto the list body goes last', () => {
    expect(drag(10, 'list-drop:2')).toEqual({ listId: 2, beforeId: 21, afterId: null });
  });
  it('same list down and up', () => {
    expect(drag(10, 'card:12')).toEqual({ listId: 1, beforeId: 12, afterId: null });
    expect(drag(12, 'card:10')).toEqual({ listId: 1, beforeId: null, afterId: 10 });
  });
  it('cross-list, dropped over another card of the target list', () => {
    // Crossed over 20 (card lands above it), then released over 21: final slot is 21's.
    expect(drag(10, 'card:20', false, 'card:21')).toEqual({ listId: 2, beforeId: 21, afterId: null });
  });
  it('dropping on itself keeps the previewed slot', () => {
    expect(drag(10, 'card:21', true, 'card:10')).toEqual({ listId: 2, beforeId: 21, afterId: null });
  });
  it('containerOf resolves cards, zones and lists', () => {
    const p = start();
    expect([containerOf(p, 'card:21'), containerOf(p, 'list-drop:3'), containerOf(p, 'list:1')]).toEqual([2, 3, 1]);
  });
});
