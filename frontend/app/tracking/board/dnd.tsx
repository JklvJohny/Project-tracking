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
import { announcements, cardDndId, listDndId, movedText } from './announcements';
import type { BoardData, CardSummary } from './board-cache';
import { CardPreview } from './CardPreview';
import {
  arrayMove,
  containerOf,
  dropOrder,
  dropZoneId,
  isCardId,
  isListId,
  neighboursAt,
  numOf,
  previewCrossList,
  type Preview,
} from './dnd-order';
import { useMoveCard } from './useMoveCard';
import { useMoveList } from './useMoveList';

const isCard = isCardId;
const isList = isListId;

type Dir = 'up' | 'down' | 'left' | 'right';
export type { Dir };

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

const REDUCED = '(prefers-reduced-motion: reduce)';
function subscribeReduced(cb: () => void) {
  const mq = window.matchMedia?.(REDUCED);
  mq?.addEventListener('change', cb);
  return () => mq?.removeEventListener('change', cb);
}
const reducedNow = () => !!window.matchMedia?.(REDUCED).matches;
const reducedServer = () => false;
const useReducedMotion = () => useSyncExternalStore(subscribeReduced, reducedNow, reducedServer);

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
    const total = to === card.listId ? ids.length : (byList.get(to)?.length ?? 0) + 1;
    const pos = dir === 'up' ? i : dir === 'down' ? i + 2 : 1;
    setLive(movedText(lang, 'card', card.title, listById.get(to)?.name, pos, total));
    moveCard.mutate({ cardId, toListId: to, ...nb });
  };

  const keyMoveList = (listId: number, dir: 'left' | 'right') => {
    const ids = data.lists.map((l) => l.id);
    const i = ids.indexOf(listId);
    const j = dir === 'left' ? i - 1 : i + 1;
    if (j < 0 || j >= ids.length) return;
    setLive(movedText(lang, 'list', listById.get(listId)?.name ?? '', undefined, j + 1, ids.length));
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
    const below = (a.rect.current.translated?.top ?? 0) > over.rect.top + over.rect.height / 2;
    setPreview((p) => (p ? previewCrossList(p, String(a.id), String(over.id), below) : p));
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
    const end = dropOrder(preview, String(a.id), String(over.id));
    if (!end) return setPreview(null);
    const { listId: to, ids } = end;
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
    [data, byList, lang, canDragCards, canDragLists],
  );

  const activeCard = active && isCard(active.id) ? cardById.get(numOf(active.id)) : undefined;
  const activeList = active && isList(active.id) ? listById.get(numOf(active.id)) : undefined;

  return (
    <Ctx.Provider value={ctx}>
      <DndContext
        // dnd-kit keys an effect on the sensor list, whose length must not change: when drag rights change
        // (role change, project archived or restored) the context remounts instead.
        key={sensors === allSensors ? 'drag' : 'static'}
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
              <CardPreview
                projectId={data.project.id}
                card={activeCard}
                users={data.users}
                labels={data.labels}
                members={data.members}
                // Same layout as the row it was lifted from (the "+" controls take height).
                canEdit={canDragCards}
              />
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

/**
 * dnd-kit hands every row an identity transform while a drag runs. A `translate3d(0,0,0)` on 2,000 rows promotes
 * each to its own compositor layer (about 2.4 s of layerize work over one drag), so only rows that move get one.
 */
export function isShifted(t: { x: number; y: number; scaleX: number; scaleY: number } | null) {
  return !!t && (t.x !== 0 || t.y !== 0 || t.scaleX !== 1 || t.scaleY !== 1);
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
      style={{ transform: isShifted(transform) ? CSS.Transform.toString(transform) : undefined, transition }}
      className={`card-row group relative ${isDragging ? 'opacity-40 ring-2 ring-primary/50 ring-inset' : ''}`}
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
