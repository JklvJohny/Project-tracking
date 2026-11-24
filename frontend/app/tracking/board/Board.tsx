'use client';
import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { boardAccess } from '../shared/access';
import { useBoard, useMe } from '../shared/api/queries';
import { errorMessage } from '../shared/errors';
import { useLang, useT } from '../shared/i18n';
import { AddList, COLUMN_W } from './AddList';
import { cardsByList } from './board-cache';
import { BoardDnd } from './dnd';
import { ListColumn } from './ListColumn';
import { usePanScroll } from './usePanScroll';

const TEXT = {
  th: { lists: 'ลิสต์', retry: 'ลองอีกครั้ง', loading: 'กำลังโหลดบอร์ด' },
  en: { lists: 'Lists', retry: 'Retry', loading: 'Loading board' },
};

const SKELETON_CARDS = [3, 2, 4, 2];

/**
 * The lists scroller. On sm+ it has a fixed height so the horizontal scrollbar stays on screen and each list scrolls
 * on its own (Trello style): it fills the region when the page gives the board a fixed share (`fill`), otherwise
 * it is sized to the viewport. Phones keep the flowing layout and scroll with the page.
 */
// The sideways scrollbar is hidden: the board pans with the mouse wheel and by dragging empty space
// (usePanScroll), trackpads and touch swipe natively, and keyboard focus scrolls the focused list into view.
const scrollerClass = (fill: boolean) =>
  `relative flex items-start gap-3 overflow-x-auto px-4 pb-4 cursor-default data-[panning=true]:cursor-grabbing no-scrollbar ${
    fill ? 'min-h-0 flex-1' : 'min-h-[28rem] sm:h-[max(24rem,calc(100dvh-19rem))]'
  }`;

/** Same column width and paddings as ListColumn, fixed heights: the swap to real data does not shift layout. */
export function BoardSkeleton({ fill = false }: { fill?: boolean }) {
  const t = useT(TEXT);
  return (
    <div
      className={scrollerClass(fill)}
      role="status"
      aria-label={t.loading}
    >
      {SKELETON_CARDS.map((n, i) => (
        <div key={i} aria-hidden className={`${COLUMN_W} animate-pulse rounded-xl border bg-muted/50 p-2`}>
          <div className="mb-2 h-7 w-32 rounded bg-muted" />
          <div className="flex flex-col gap-px overflow-hidden rounded-lg bg-card">
            {Array.from({ length: n }, (_, j) => (
              <div key={j} className="h-24 border-b bg-card" />
            ))}
          </div>
          <div className="mt-2 h-8 rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

export function Board({
  projectId,
  fill = false,
  visible = null,
}: {
  projectId: number;
  fill?: boolean;
  /** Ids of the cards the filter keeps, or null when no filter is on. */
  visible?: Set<number> | null;
}) {
  const t = useT(TEXT);
  const { lang } = useLang();
  const board = useBoard(projectId);
  const me = useMe();
  const panHandlers = usePanScroll();
  const data = board.data;
  const byList = useMemo(() => {
    if (!data) return null;
    const all = cardsByList(data);
    if (!visible) return all;
    return new Map([...all].map(([listId, cards]) => [listId, cards.filter((c) => visible.has(c.id))]));
  }, [data, visible]);

  if (board.isPending) return <BoardSkeleton fill={fill} />;
  // A failed background refetch (for example right after a failed move) must not hide a board we already have.
  if (!data || !byList)
    return (
      <div role="alert" className="mx-4 flex flex-col items-start gap-3 rounded-lg border p-6">
        <p className="text-sm">{errorMessage(board.error, lang)}</p>
        <Button variant="outline" onClick={() => board.refetch()}>
          {t.retry}
        </Button>
      </div>
    );

  // Admin/pm manage lists; admin/pm/member add cards. An archived project is read-only.
  const { canManage, canEdit: canAddCards } = boardAccess(data);
  // Admin/PM tick any card's checklist; a member only cards assigned to them (canTickCard has the rule).
  const meId = me.data?.user?.id;

  return (
    // A drop among hidden cards would land where the user cannot see, so cards do not drag while filtered.
    <BoardDnd projectId={projectId} data={data} byList={byList} canDragCards={canAddCards && !visible} canDragLists={canManage}>
      {(cardsOf) => (
        <div role="group" aria-label={t.lists} className={scrollerClass(fill)} {...panHandlers}>
          {data.lists.map((l) => (
            <ListColumn
              key={l.id}
              projectId={projectId}
              list={l}
              cards={cardsOf(l.id)}
              users={data.users}
              labels={data.labels}
              members={data.members}
              canManage={canManage}
              canAddCards={canAddCards}
              canTickAny={canManage}
              meId={meId}
            />
          ))}
          {canManage && <AddList projectId={projectId} />}
        </div>
      )}
    </BoardDnd>
  );
}
