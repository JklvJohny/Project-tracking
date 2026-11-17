'use client';
import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { useBoard } from '../shared/api/queries';
import { errorMessage } from '../shared/errors';
import { useLang, useT } from '../shared/i18n';
import { AddList, COLUMN_W } from './AddList';
import { cardsByList } from './board-cache';
import { ListColumn } from './ListColumn';

const TEXT = {
  th: { lists: 'ลิสต์', retry: 'ลองอีกครั้ง', loading: 'กำลังโหลดบอร์ด' },
  en: { lists: 'Lists', retry: 'Retry', loading: 'Loading board' },
};

const SKELETON_CARDS = [3, 2, 4, 2];

/** Same column width and paddings as ListColumn, fixed heights: the swap to real data does not shift layout. */
export function BoardSkeleton() {
  const t = useT(TEXT);
  return (
    <div className="flex items-start gap-3 overflow-x-auto px-4 pb-4" role="status" aria-label={t.loading}>
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

export function Board({ projectId }: { projectId: number }) {
  const t = useT(TEXT);
  const { lang } = useLang();
  const board = useBoard(projectId);
  const data = board.data;
  const byList = useMemo(() => (data ? cardsByList(data) : null), [data]);

  if (board.isPending) return <BoardSkeleton />;
  if (board.isError || !data || !byList)
    return (
      <div role="alert" className="mx-4 flex flex-col items-start gap-3 rounded-lg border p-6">
        <p className="text-sm">{errorMessage(board.error, lang)}</p>
        <Button variant="outline" onClick={() => board.refetch()}>
          {t.retry}
        </Button>
      </div>
    );

  // Viewers get no controls; admin/pm manage lists; admin/pm/member add cards.
  const canManage = data.myRole === 'admin' || data.myRole === 'pm';
  const canAddCards = canManage || data.myRole === 'member';

  return (
    <div role="group" aria-label={t.lists} className="flex min-h-[28rem] items-start gap-3 overflow-x-auto px-4 pb-4">
      {data.lists.map((l) => (
        <ListColumn
          key={l.id}
          projectId={projectId}
          list={l}
          cards={byList.get(l.id) ?? []}
          users={data.users}
          labels={data.labels}
          canManage={canManage}
          canAddCards={canAddCards}
        />
      ))}
      {canManage && <AddList projectId={projectId} />}
    </div>
  );
}
