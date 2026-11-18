'use client';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CheckCircle2, Archive, GripVertical } from 'lucide-react';
import { memo, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { components } from '../shared/api/schema';
import { useT } from '../shared/i18n';
import { AddCard } from './AddCard';
import { cardDndId } from './announcements';
import { COLUMN_W } from './AddList';
import type { CardSummary, ListData } from './board-cache';
import { CardPreview } from './CardPreview';
import { SortableCard, useDndCtx, useSortableList } from './dnd';
import { ListMenu } from './ListMenu';
import { useArchiveCard, useUpdateList } from './mutations';

type S = components['schemas'];

const TEXT = {
  th: {
    renameLabel: 'ชื่อลิสต์',
    count: (n: number) => `${n} การ์ด`,
    done: 'ลิสต์เสร็จสิ้น',
    empty: 'ยังไม่มีการ์ด',
    cards: (n: string) => `การ์ดใน ${n}`,
    archiveCard: (title: string) => `เก็บการ์ด ${title} ถาวร`,
    dragList: (n: string) => `ย้ายลิสต์ ${n} (Space หรือ Alt+ลูกศร)`,
  },
  en: {
    renameLabel: 'List name',
    count: (n: number) => `${n} card${n === 1 ? '' : 's'}`,
    done: 'Done list',
    empty: 'No cards yet',
    cards: (n: string) => `Cards in ${n}`,
    archiveCard: (title: string) => `Archive card ${title}`,
    dragList: (n: string) => `Move list ${n} (Space or Alt+arrows)`,
  },
};

type ListCardsProps = Pick<ListColumnProps, 'projectId' | 'cards' | 'users' | 'labels' | 'canAddCards'>;

/**
 * The rows live in their own memoised component: ListColumn re-renders on every pointer move of a drag (its
 * sortable hooks subscribe to dnd-kit's context), and without this boundary each of those renders rebuilt every
 * row of the list.
 */
const ListCards = memo(function ListCards({ projectId, cards, users, labels, canAddCards }: ListCardsProps) {
  const t = useT(TEXT);
  const archiveCard = useArchiveCard(projectId);
  return (
    <>
        <SortableContext items={cards.map((c) => cardDndId(c.id))} strategy={verticalListSortingStrategy}>
          {cards.length === 0 && <li className="px-3 py-6 text-center text-xs text-muted-foreground">{t.empty}</li>}
          {cards.map((c) => (
            <SortableCard key={c.id} card={c}>
              <CardPreview card={c} users={users} labels={labels} actionSpace={canAddCards} />
              {canAddCards && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="absolute top-2 right-2 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
                  aria-label={t.archiveCard(c.title)}
                  title={t.archiveCard(c.title)}
                  onClick={() => archiveCard.mutate(c)}
                  // Pressing the button must never start a drag from the row around it.
                  onPointerDown={(e) => e.stopPropagation()}
                  onTouchStart={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <Archive aria-hidden />
                </Button>
              )}
            </SortableCard>
          ))}
        </SortableContext>
    </>
  );
}, sameProps);

/**
 * A drag preview hands every list a fresh `cards` array, equal or not. Comparing the cards element-wise keeps
 * the lists the drag does not touch from re-rendering all of their rows on each pointer move.
 */
function sameProps<P extends { cards: CardSummary[] }>(a: P, b: P) {
  if (a.cards !== b.cards && (a.cards.length !== b.cards.length || a.cards.some((c, i) => c !== b.cards[i]))) return false;
  return (Object.keys(a) as (keyof P)[]).every((k) => k === 'cards' || a[k] === b[k]);
}

type ListColumnProps = {
  projectId: number;
  list: ListData;
  cards: CardSummary[];
  users: S['User'][];
  labels: S['BoardLabel'][];
  canManage: boolean;
  canAddCards: boolean;
};

export const ListColumn = memo(function ListColumn({
  projectId,
  list,
  cards,
  users,
  labels,
  canManage,
  canAddCards,
}: ListColumnProps) {
  const t = useT(TEXT);
  const update = useUpdateList(projectId);
  const { canDragCards, canDragLists } = useDndCtx();
  const { setColumn, columnStyle, setHandle, handleProps, setDrop, isDragging, isOver } = useSortableList(list.id);
  const [renaming, setRenaming] = useState(false);
  // Enter/Escape unmount the focused input, which can fire blur: settled makes commit run once and never after Escape.
  const settled = useRef(false);

  function commit(value: string) {
    if (settled.current) return;
    settled.current = true;
    setRenaming(false);
    const name = value.trim();
    if (name && name !== list.name) update.mutate({ listId: list.id, name });
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) commit(e.currentTarget.value);
    else if (e.key === 'Escape') {
      settled.current = true;
      setRenaming(false);
    }
  };

  return (
    <section
      ref={setColumn}
      style={columnStyle}
      aria-labelledby={`list-h-${list.id}`}
      className={`${COLUMN_W} flex max-h-full flex-col rounded-xl border border-border/70 bg-muted/50 ${
        isDragging ? 'opacity-40' : ''
      }`}
    >
      <div className="flex items-center gap-1 px-3 pt-2 pb-1">
        {canDragLists && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="-ml-2 cursor-grab touch-none text-muted-foreground"
            aria-label={t.dragList(list.name)}
            title={t.dragList(list.name)}
            ref={setHandle}
            {...handleProps}
          >
            <GripVertical aria-hidden />
          </Button>
        )}
        {renaming ? (
          <Input
            autoFocus
            defaultValue={list.name}
            maxLength={100}
            aria-label={t.renameLabel}
            onKeyDown={onKeyDown}
            onBlur={(e) => commit(e.currentTarget.value)}
            className="h-7 flex-1 px-2 text-sm font-semibold"
          />
        ) : (
          <h2 id={`list-h-${list.id}`} className="min-w-0 flex-1 truncate py-1 text-sm font-semibold">
            {list.name}
          </h2>
        )}
        {list.isDone && <CheckCircle2 className="size-4 shrink-0 text-(--s-done)" aria-label={t.done} role="img" />}
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground tabular-nums">
          <span aria-hidden>{cards.length}</span>
          <span className="sr-only">{t.count(cards.length)}</span>
        </span>
        {canManage && (
          <ListMenu
            projectId={projectId}
            list={list}
            onRename={() => {
              settled.current = false;
              setRenaming(true);
            }}
          />
        )}
      </div>
      <ol
        ref={setDrop}
        aria-label={t.cards(list.name)}
        className={`mx-2 mt-1 flex min-h-14 flex-col divide-y divide-border overflow-y-auto rounded-lg bg-card shadow-sm ring-1 ring-border/60 ${
          isOver && canDragCards ? 'bg-primary/5 outline-2 -outline-offset-2 outline-primary/60 outline-dashed' : ''
        }`}
      >
        <ListCards projectId={projectId} cards={cards} users={users} labels={labels} canAddCards={canAddCards} />
      </ol>
      {canAddCards && <AddCard projectId={projectId} listId={list.id} listName={list.name} />}
      {!canAddCards && <div className="h-2" />}
    </section>
  );
}, sameProps);
