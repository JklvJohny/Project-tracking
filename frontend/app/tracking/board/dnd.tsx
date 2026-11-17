'use client';
import {
  useDroppable,
  closestCenter,
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { useLang } from '../shared/i18n';
import { announcements, cardDndId, listDndId } from './announcements';
import type { BoardData, CardSummary } from './board-cache';
import { CardPreview } from './CardPreview';
import { useMoveCard } from './useMoveCard';
import { useMoveList } from './useMoveList';

export const dropZoneId = (listId: number) => `list-drop:${listId}`;
const numOf = (id: UniqueIdentifier) => Number(String(id).split(':')[1]);
const isCard = (id: UniqueIdentifier) => String(id).startsWith('card:');
const isList = (id: UniqueIdentifier) => String(id).startsWith('list:');

type Preview = Map<number, number[]>;
export type Dir = 'up' | 'down' | 'left' | 'right';

/** Server neighbours of `movedId` inside `ids` (the order after the drop): above = beforeId, below = afterId, itself excluded. */
export function neighboursAt(ids: number[], movedId: number) {
  const others = ids.filter((x) => x !== movedId);
  const idx = ids.indexOf(movedId);
  return { beforeId: others[idx - 1] ?? null, afterId: others[idx] ?? null };
}

function containerOf(p: Preview, id: UniqueIdentifier): number | undefined {
  const s = String(id);
  if (s.startsWith('list-drop:') || s.startsWith('list:')) return numOf(id);
  const cid = numOf(id);
  for (const [l, ids] of p) if (ids.includes(cid)) return l;
}

/** Cards only collide with cards and list drop zones, lists only with lists. */
const collision: CollisionDetection = (args) => {
  const wantList = isList(args.active.id);
  const droppableContainers = args.droppableContainers.filter((c) => (wantList ? isList(c.id) : !isList(c.id)));
  return (wantList ? closestCenter : closestCorners)({
    ...args,
    droppableContainers,
  });
};

const noop = () => {};
const Ctx = createContext<{
  moveCard: (cardId: number, dir: Dir) => void;
  moveList: (listId: number, dir: 'left' | 'right') => void;
  canDragCards: boolean;
  canDragLists: boolean;
}>({
  moveCard: noop,
  moveList: noop,
  canDragCards: false,
  canDragLists: false,
});
export const useDndCtx = () => useContext(Ctx);

function useReducedMotion() {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
      mq?.addEventListener('change', cb);
      return () => mq?.removeEventListener('change', cb);
    },
    () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    () => false,
  );
}

const ALT_DIR: Record<string, Dir> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

/** Alt+Arrow handler shared by card and list handles; true when it consumed the key. */
export function altArrow(e: KeyboardEvent, run: (d: Dir) => void): boolean {
  const d = ALT_DIR[e.key];
  if (!e.altKey || !d) return false;
  e.preventDefault();
  e.stopPropagation();
  run(d);
  return true;
}

export function BoardDnd({
  projectId,
  data,
  byList,
  canDragCards,
  canDragLists,
  children,
}: {
  projectId: number;
  data: BoardData;
  byList: Map<number, CardSummary[]>;
  canDragCards: boolean;
  canDragLists: boolean;
  children: (cardsOf: (listId: number) => CardSummary[]) => ReactNode;
}) {
  const { lang } = useLang();
  const reduced = useReducedMotion();
  const moveCard = useMoveCard(projectId);
  const moveList = useMoveList(projectId);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [active, setActive] = useState<{
    id: UniqueIdentifier;
    width?: number;
  } | null>(null);
  const [live, setLive] = useState('');
  const origin = useRef<{ listId: number; ids: number[] } | null>(null);
  const droppedRef = useRef(false);
  const focusRef = useRef<string | null>(null);

  // Viewers get an empty sensor list: nothing can start a drag.
  const allSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const noSensors = useSensors();
  const sensors = canDragCards || canDragLists ? allSensors : noSensors;

  const cardById = useMemo(() => new Map(data.cards.map((c) => [c.id, c])), [data.cards]);
  const listById = useMemo(() => new Map(data.lists.map((l) => [l.id, l])), [data.lists]);
  const nameOf = useCallback(
    (id: UniqueIdentifier) => (isList(id) ? listById.get(numOf(id))?.name : cardById.get(numOf(id))?.title),
    [cardById, listById],
  );
  const text = useMemo(() => announcements(lang, nameOf), [lang, nameOf]);

  const cardsOf = useCallback(
    (listId: number) =>
      preview
        ? (preview.get(listId) ?? []).map((id) => cardById.get(id)).filter((c) => !!c)
        : (byList.get(listId) ?? []),
    [preview, byList, cardById],
  );

  // The optimistic write replaces the drag preview; clearing earlier would flash the old order for a frame.
  useEffect(() => {
    if (droppedRef.current) {
      droppedRef.current = false;
      setPreview(null);
    }
  }, [data]);

  // A keyboard move remounts the card in another column: give focus back to it.
  useEffect(() => {
    const id = focusRef.current;
    if (!id) return;
    focusRef.current = null;
    document.querySelector<HTMLElement>(`[data-card-id="${id}"]`)?.focus();
  }, [data]);

  const keyMoveCard = (cardId: number, dir: Dir) => {
    const card = cardById.get(cardId);
    if (!card) return;
    const ids = (byList.get(card.listId) ?? []).map((c) => c.id);
    const i = ids.indexOf(cardId);
    let to = card.listId;
    let nb: { beforeId: number | null; afterId: number | null };
    if (dir === 'up' || dir === 'down') {
      const j = dir === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= ids.length) return;
      nb = neighboursAt(arrayMove(ids, i, j), cardId);
    } else {
      const li = data.lists.findIndex((l) => l.id === card.listId);
      const target = data.lists[li + (dir === 'left' ? -1 : 1)];
      if (!target) return;
      to = target.id;
      nb = { beforeId: null, afterId: byList.get(target.id)?.[0]?.id ?? null }; // top of the neighbouring list
    }
    focusRef.current = String(cardId);
    setLive(
      text.onDragEnd?.({
        active: { id: cardDndId(cardId) },
        over: null,
      } as never) ?? '',
    );
    moveCard.mutate({ cardId, toListId: to, ...nb });
  };

  const keyMoveList = (listId: number, dir: 'left' | 'right') => {
    const ids = data.lists.map((l) => l.id);
    const i = ids.indexOf(listId);
    const j = dir === 'left' ? i - 1 : i + 1;
    if (j < 0 || j >= ids.length) return;
    setLive(
      text.onDragEnd?.({
        active: { id: listDndId(listId) },
        over: null,
      } as never) ?? '',
    );
    moveList.mutate({ listId, ...neighboursAt(arrayMove(ids, i, j), listId) });
  };

  function onDragStart(e: DragStartEvent) {
    setActive({ id: e.active.id, width: e.active.rect.current.initial?.width });
    if (!isCard(e.active.id)) return;
    const p: Preview = new Map(data.lists.map((l) => [l.id, (byList.get(l.id) ?? []).map((c) => c.id)]));
    const listId = containerOf(p, e.active.id)!;
    origin.current = { listId, ids: p.get(listId)! };
    setPreview(p);
  }

  function onDragOver({ active: a, over }: DragOverEvent) {
    if (!over || !isCard(a.id)) return;
    setPreview((p) => {
      if (!p) return p;
      const from = containerOf(p, a.id);
      const to = containerOf(p, over.id);
      if (from == null || to == null || from === to) return p;
      const cid = numOf(a.id);
      const target = p.get(to)!;
      let idx = target.length;
      if (isCard(over.id)) {
        const below = (a.rect.current.translated?.top ?? 0) > over.rect.top + over.rect.height / 2;
        idx = target.indexOf(numOf(over.id)) + (below ? 1 : 0);
      }
      const next = new Map(p);
      next.set(
        from,
        p.get(from)!.filter((x) => x !== cid),
      );
      next.set(to, [...target.slice(0, idx), cid, ...target.slice(idx)]);
      return next;
    });
  }

  function onDragEnd({ active: a, over }: DragEndEvent) {
    setActive(null);
    if (isList(a.id)) {
      if (!over || a.id === over.id) return;
      const ids = data.lists.map((l) => l.id);
      const next = arrayMove(ids, ids.indexOf(numOf(a.id)), ids.indexOf(numOf(over.id)));
      moveList.mutate({
        listId: numOf(a.id),
        ...neighboursAt(next, numOf(a.id)),
      });
      return;
    }
    const o = origin.current;
    origin.current = null;
    if (!preview || !o || !over) return setPreview(null);
    const cid = numOf(a.id);
    const to = containerOf(preview, a.id)!;
    let ids = preview.get(to)!;
    if (isCard(over.id) && over.id !== a.id && containerOf(preview, over.id) === to) {
      ids = arrayMove(ids, ids.indexOf(cid), ids.indexOf(numOf(over.id)));
    }
    if (to === o.listId && ids.length === o.ids.length && ids.every((x, i) => x === o.ids[i])) return setPreview(null);
    droppedRef.current = true;
    moveCard.mutate({ cardId: cid, toListId: to, ...neighboursAt(ids, cid) }, { onSettled: () => setPreview(null) });
  }

  const onDragCancel = () => {
    setActive(null);
    origin.current = null;
    setPreview(null);
  };

  const ctx = useMemo(
    () => ({
      moveCard: keyMoveCard,
      moveList: keyMoveList,
      canDragCards,
      canDragLists,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the handlers close over data/byList/text, which change with them
    [data, byList, text, canDragCards, canDragLists],
  );

  const activeCard = active && isCard(active.id) ? cardById.get(numOf(active.id)) : undefined;
  const activeList = active && isList(active.id) ? listById.get(numOf(active.id)) : undefined;

  return (
    <Ctx.Provider value={ctx}>
      <DndContext
        sensors={sensors}
        collisionDetection={collision}
        accessibility={{ announcements: text }}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <SortableContext items={data.lists.map((l) => listDndId(l.id))} strategy={horizontalListSortingStrategy}>
          {children(cardsOf)}
        </SortableContext>
        <DragOverlay dropAnimation={reduced ? null : undefined}>
          {activeCard && (
            <div style={{ width: active?.width }} className="rounded-lg bg-card shadow-lg ring-2 ring-primary/60">
              <CardPreview card={activeCard} users={data.users} labels={data.labels} />
            </div>
          )}
          {activeList && (
            <div className="w-72 rounded-xl border bg-muted px-3 py-2 text-sm font-semibold shadow-lg ring-2 ring-primary/60">
              {activeList.name}
            </div>
          )}
        </DragOverlay>
      </DndContext>
      <div role="status" aria-live="polite" className="sr-only">
        {live}
      </div>
    </Ctx.Provider>
  );
}

/** Thin sortable shell for one card row; the heavy content is the memoised CardPreview passed as children. */
export function SortableCard({ card, children }: { card: CardSummary; children: ReactNode }) {
  const { canDragCards, moveCard } = useDndCtx();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: cardDndId(card.id),
    disabled: !canDragCards,
  });
  // The row itself is the keyboard activator, so Space/Enter on the link or archive button inside never starts a drag.
  const ref = useCallback(
    (n: HTMLLIElement | null) => {
      setNodeRef(n);
      setActivatorNodeRef(n);
    },
    [setNodeRef, setActivatorNodeRef],
  );
  const drag = canDragCards
    ? {
        ...attributes,
        role: 'listitem', // dnd-kit's default role=button would hide the card link inside
        'data-card-id': card.id,
        ...listeners,
        onKeyDown: (e: KeyboardEvent<HTMLLIElement>) => {
          if (!altArrow(e, (d) => moveCard(card.id, d))) listeners?.onKeyDown?.(e);
        },
      }
    : {};
  return (
    <li
      ref={ref}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group relative ${isDragging ? 'opacity-40 ring-2 ring-primary/50 ring-inset' : ''}`}
      {...drag}
    >
      {children}
    </li>
  );
}

/** Column-level sortable + card drop zone. Kept here so dnd-kit's ref-returning hooks stay out of ListColumn. */
export function useSortableList(listId: number) {
  const { canDragLists, moveList } = useDndCtx();
  const sortable = useSortable({ id: listDndId(listId), disabled: !canDragLists });
  const drop = useDroppable({ id: dropZoneId(listId) });
  return {
    // Named setX (not xRef): the React Compiler lint treats ref-looking names as refs read during render.
    setColumn: sortable.setNodeRef,
    setHandle: sortable.setActivatorNodeRef,
    setDrop: drop.setNodeRef,
    columnStyle: { transform: CSS.Translate.toString(sortable.transform), transition: sortable.transition },
    handleProps: {
      ...sortable.attributes,
      ...sortable.listeners,
      onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
        const run = (d: Dir) => (d === 'left' || d === 'right') && moveList(listId, d);
        if (!altArrow(e, run)) sortable.listeners?.onKeyDown?.(e);
      },
    },
    isDragging: sortable.isDragging,
    isOver: drop.isOver,
  };
}
