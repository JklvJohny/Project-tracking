'use client';
import { CheckCircle2, Archive } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { components } from '../shared/api/schema';
import { useT } from '../shared/i18n';
import { AddCard } from './AddCard';
import { COLUMN_W } from './AddList';
import type { CardSummary, ListData } from './board-cache';
import { CardPreview } from './CardPreview';
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
  },
  en: {
    renameLabel: 'List name',
    count: (n: number) => `${n} card${n === 1 ? '' : 's'}`,
    done: 'Done list',
    empty: 'No cards yet',
    cards: (n: string) => `Cards in ${n}`,
    archiveCard: (title: string) => `Archive card ${title}`,
  },
};

export function ListColumn({
  projectId,
  list,
  cards,
  users,
  labels,
  canManage,
  canAddCards,
}: {
  projectId: number;
  list: ListData;
  cards: CardSummary[];
  users: S['User'][];
  labels: S['BoardLabel'][];
  canManage: boolean;
  canAddCards: boolean;
}) {
  const t = useT(TEXT);
  const update = useUpdateList(projectId);
  const archiveCard = useArchiveCard(projectId);
  const [renaming, setRenaming] = useState(false);

  function commit(value: string) {
    setRenaming(false);
    const name = value.trim();
    if (name && name !== list.name) update.mutate({ listId: list.id, name });
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) commit(e.currentTarget.value);
    else if (e.key === 'Escape') setRenaming(false);
  };

  return (
    <section
      aria-labelledby={`list-h-${list.id}`}
      className={`${COLUMN_W} flex max-h-full flex-col rounded-xl border border-border/70 bg-muted/50`}
    >
      <div className="flex items-center gap-1 px-3 pt-2 pb-1">
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
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground tabular-nums" aria-label={t.count(cards.length)}>
          {cards.length}
        </span>
        {canManage && <ListMenu projectId={projectId} list={list} onRename={() => setRenaming(true)} />}
      </div>
      <ol
        aria-label={t.cards(list.name)}
        className="mx-2 mt-1 flex min-h-14 flex-col divide-y divide-border overflow-y-auto rounded-lg bg-card shadow-sm ring-1 ring-border/60"
      >
        {cards.length === 0 && <li className="px-3 py-6 text-center text-xs text-muted-foreground">{t.empty}</li>}
        {cards.map((c) => (
          <li key={c.id} className="group relative">
            <CardPreview card={c} users={users} labels={labels} />
            {canAddCards && (
              <Button
                variant="ghost"
                size="icon-xs"
                className="absolute top-2 right-2 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
                aria-label={t.archiveCard(c.title)}
                title={t.archiveCard(c.title)}
                onClick={() => archiveCard.mutate(c)}
              >
                <Archive aria-hidden />
              </Button>
            )}
          </li>
        ))}
      </ol>
      {canAddCards && <AddCard projectId={projectId} listId={list.id} listName={list.name} />}
      {!canAddCards && <div className="h-2" />}
    </section>
  );
}
