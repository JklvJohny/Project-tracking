// Pure order logic of the pointer path (no React, no dnd-kit objects), so it can be unit-tested.
// A preview maps listId -> card ids in display order while a card is being dragged.
export type Preview = Map<number, number[]>;

export const dropZoneId = (listId: number) => `list-drop:${listId}`;
export const numOf = (id: string | number) => Number(String(id).split(':')[1]);
export const isCardId = (id: string | number) => String(id).startsWith('card:');
export const isListId = (id: string | number) => String(id).startsWith('list:');

export function arrayMove<T>(arr: T[], from: number, to: number): T[] {
  const next = arr.slice();
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}

/** Server neighbours of `movedId` inside `ids` (the order after the drop): above = beforeId, below = afterId, itself excluded. */
export function neighboursAt(ids: number[], movedId: number) {
  const others = ids.filter((x) => x !== movedId);
  const idx = ids.indexOf(movedId);
  return { beforeId: others[idx - 1] ?? null, afterId: others[idx] ?? null };
}

/** List an id belongs to: a list column, a list drop zone, or the list currently holding that card in the preview. */
export function containerOf(p: Preview, id: string | number): number | undefined {
  const s = String(id);
  if (s.startsWith('list-drop:') || s.startsWith('list:')) return numOf(id);
  const cid = numOf(id);
  for (const [l, ids] of p) if (ids.includes(cid)) return l;
}

/**
 * dragOver step: when the dragged card crosses into another list, move it there in the preview. Over a card it
 * goes above it, or below when the pointer is past the card's middle; over the list itself it goes last.
 */
export function previewCrossList(p: Preview, activeId: string, overId: string, below: boolean): Preview {
  const from = containerOf(p, activeId);
  const to = containerOf(p, overId);
  if (from == null || to == null || from === to) return p;
  const cid = numOf(activeId);
  const target = p.get(to)!;
  const idx = isCardId(overId) ? target.indexOf(numOf(overId)) + (below ? 1 : 0) : target.length;
  const next = new Map(p);
  next.set(
    from,
    p.get(from)!.filter((x) => x !== cid),
  );
  next.set(to, [...target.slice(0, idx), cid, ...target.slice(idx)]);
  return next;
}

/**
 * dragEnd: the list the card ends in and its order there. Dropping onto another card of that list moves the
 * card to that card's slot. Needed even after a cross-list preview: the preview placed the card by the pointer
 * at the crossing, the drop slot is where it finally rests (see tests).
 */
export function dropOrder(p: Preview, activeId: string, overId: string): { listId: number; ids: number[] } | undefined {
  const listId = containerOf(p, activeId);
  if (listId == null) return;
  let ids = p.get(listId)!;
  const cid = numOf(activeId);
  if (isCardId(overId) && overId !== activeId && containerOf(p, overId) === listId) {
    ids = arrayMove(ids, ids.indexOf(cid), ids.indexOf(numOf(overId)));
  }
  return { listId, ids };
}
