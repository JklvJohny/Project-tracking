// Pure helpers that patch the cached board snapshot (no React, no fetch). Every board write goes
// through these via setQueryData; the board is never invalidated on a write.
//
// Order contract: the order of `cards` / `lists` in the arrays IS the display order. Moves reorder the
// arrays and leave `position` strings untouched (they go stale until the server response for that item
// replaces it). Insertions of new items therefore compare `position` only against items that were not
// moved locally in practice (new/restored items), and the server's own order is ascending by position.
import type { components } from '../shared/api/schema';

type S = components['schemas'];
export type BoardData = S['Board'];
export type CardSummary = S['CardSummary'];
export type ListData = S['List'];

type Neighbours = { beforeId?: number | null; afterId?: number | null };

/** Index at which an item with the given neighbours should sit, after removing it from `arr`. */
function slot<T extends { id: number }>(arr: T[], { beforeId, afterId }: Neighbours, fallback: number): number {
  if (beforeId != null) {
    const i = arr.findIndex((x) => x.id === beforeId);
    if (i >= 0) return i + 1;
  }
  if (afterId != null) {
    const i = arr.findIndex((x) => x.id === afterId);
    if (i >= 0) return i;
  }
  return fallback;
}

function insertAt<T>(arr: T[], i: number, item: T): T[] {
  return [...arr.slice(0, i), item, ...arr.slice(i)];
}

export function cardsByList(b: BoardData): Map<number, CardSummary[]> {
  const m = new Map<number, CardSummary[]>(b.lists.map((l) => [l.id, []]));
  for (const c of b.cards) m.get(c.listId)?.push(c);
  return m;
}

/** Replaces by id in place; a new card is placed by position among its list's cards. Cards of lists not on the board are ignored. */
export function upsertCard(b: BoardData, card: CardSummary): BoardData {
  const i = b.cards.findIndex((c) => c.id === card.id);
  if (i >= 0) return { ...b, cards: b.cards.map((c, j) => (j === i ? card : c)) };
  if (!b.lists.some((l) => l.id === card.listId)) return b;
  const next = b.cards.findIndex((c) => c.listId === card.listId && c.position > card.position);
  return { ...b, cards: next >= 0 ? insertAt(b.cards, next, card) : [...b.cards, card] };
}

export function removeCard(b: BoardData, cardId: number): BoardData {
  return b.cards.some((c) => c.id === cardId) ? { ...b, cards: b.cards.filter((c) => c.id !== cardId) } : b;
}

/** beforeId = card ending up immediately above, afterId = immediately below (same as the backend). */
export function moveCardLocal(
  b: BoardData,
  m: { cardId: number; toListId: number } & Neighbours,
): BoardData {
  const card = b.cards.find((c) => c.id === m.cardId);
  if (!card) return b;
  const rest = b.cards.filter((c) => c.id !== m.cardId);
  const moved = { ...card, listId: m.toListId };
  return { ...b, cards: insertAt(rest, slot(rest, m, rest.length), moved) };
}

/** Replaces by id; a new list is placed by position. An archived list leaves the board together with its cards. */
export function upsertList(b: BoardData, list: ListData): BoardData {
  if (list.archivedAt) {
    return {
      ...b,
      lists: b.lists.filter((l) => l.id !== list.id),
      cards: b.cards.filter((c) => c.listId !== list.id),
    };
  }
  const i = b.lists.findIndex((l) => l.id === list.id);
  if (i >= 0) return { ...b, lists: b.lists.map((l, j) => (j === i ? list : l)) };
  const next = b.lists.findIndex((l) => l.position > list.position);
  return { ...b, lists: next >= 0 ? insertAt(b.lists, next, list) : [...b.lists, list] };
}

export function moveListLocal(b: BoardData, m: { listId: number } & Neighbours): BoardData {
  const list = b.lists.find((l) => l.id === m.listId);
  if (!list) return b;
  const rest = b.lists.filter((l) => l.id !== m.listId);
  return { ...b, lists: insertAt(rest, slot(rest, m, rest.length), list) };
}

/** Mirrors the server: cards of a done list carry completedAt, and leaving done clears it. */
export function setListCompletion(b: BoardData, listId: number, completedAt: string | null): BoardData {
  return {
    ...b,
    cards: b.cards.map((c) =>
      c.listId !== listId ? c : { ...c, completedAt: completedAt ? (c.completedAt ?? completedAt) : null },
    ),
  };
}

/** Board-card fields of a CardDetail. Fields the detail lacks (commentCount) come from `prev` when known. */
export function detailToSummary(d: S['CardDetail'], prev?: CardSummary): CardSummary {
  return {
    id: d.id,
    listId: d.listId,
    title: d.title,
    priority: d.priority,
    startDate: d.startDate,
    dueDate: d.dueDate,
    position: d.position,
    completedAt: d.completedAt,
    updatedAt: d.updatedAt,
    labelIds: d.labelIds,
    assigneeIds: d.assigneeIds,
    checklistTotal: d.checklist.length,
    checklistDone: d.checklist.filter((i) => i.isDone).length,
    commentCount: prev?.commentCount ?? 0,
  };
}

/** Mirrors a comment add (+1) or delete (-1) onto the board card's badge. */
export function bumpCommentCount(b: BoardData, cardId: number, delta: number): BoardData {
  return b.cards.some((c) => c.id === cardId)
    ? { ...b, cards: b.cards.map((c) => (c.id === cardId ? { ...c, commentCount: Math.max(0, c.commentCount + delta) } : c)) }
    : b;
}

type BoardProjectData = BoardData['project'];
type BoardMember = S['BoardMember'];

/** Copies the board-visible fields of a Project response onto the cached board project. */
export function patchBoardProject(b: BoardData, p: S['Project']): BoardData {
  const project: BoardProjectData = {
    id: p.id,
    name: p.name,
    description: p.description,
    ownerId: p.ownerId,
    status: p.status,
    startDate: p.startDate,
    endDate: p.endDate,
    archivedAt: p.archivedAt,
  };
  return { ...b, project };
}

/** Adds or replaces a member and makes sure the board knows the person's profile. */
export function upsertMember(b: BoardData, m: S['Member']): BoardData {
  const member: BoardMember = { userId: m.userId, name: m.name, avatarUrl: m.avatarUrl, role: m.role };
  const members = b.members.some((x) => x.userId === m.userId)
    ? b.members.map((x) => (x.userId === m.userId ? member : x))
    : [...b.members, member];
  const users = b.users.some((u) => u.id === m.userId)
    ? b.users
    : [...b.users, { id: m.userId, name: m.name, avatarUrl: m.avatarUrl }];
  return { ...b, members, users };
}

/** The profile stays in `users`: the person may still be an assignee on cards. */
export function dropMember(b: BoardData, userId: number): BoardData {
  return b.members.some((x) => x.userId === userId) ? { ...b, members: b.members.filter((x) => x.userId !== userId) } : b;
}
