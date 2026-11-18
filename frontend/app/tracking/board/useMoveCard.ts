'use client';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../shared/api/client';
import { qk } from '../shared/api/queries';
import type { components } from '../shared/api/schema';
import { errorKey, errorText } from '../shared/errors';
import { useLang, useT } from '../shared/i18n';
import { detailToSummary, moveCardLocal, upsertCard, type BoardData } from './board-cache';

type S = components['schemas'];
export type MoveCardInput = {
  cardId: number;
  toListId: number;
  beforeId?: number | null;
  afterId?: number | null;
};

const TEXT = { th: { retry: 'ลองอีกครั้ง' }, en: { retry: 'Retry' } };

/** Card and list moves share one key, so "is another move still in flight" is a single count. */
export const moveKey = (projectId: number) => ['move', projectId] as const;

// Failure flag per client+project, shared by the card and list hooks (two hook instances, one batch).
const failedBatch = new WeakMap<QueryClient, Set<number>>();

/**
 * Failure and settle path of card and list moves.
 *
 * Why not just restore the snapshot: with moves A then B in flight, B's snapshot already contains A's optimistic
 * move, so if both fail B's restore would resurrect A's rejected move. Each failure still restores (instant
 * feedback), but the last move to settle in a batch that saw any failure refetches the board, so the final
 * state is the server's. Serialising with a mutation scope was rejected: onMutate still runs immediately for
 * queued mutations, so the snapshots would not change, and queued drags would feel laggy.
 */
export function useMoveFailure(projectId: number) {
  const qc = useQueryClient();
  const { lang } = useLang();
  const t = useT(TEXT);
  const key = qk.board(projectId);
  const mark = () => {
    const set = failedBatch.get(qc) ?? new Set<number>();
    set.add(projectId);
    failedBatch.set(qc, set);
  };
  return {
    onFail(e: unknown, prev: BoardData | undefined, retry: () => void) {
      mark();
      if (prev) qc.setQueryData(key, prev);
      if (errorKey(e) === 'stale_order') toast(errorText('stale_order', lang));
      else toast.error(errorText(errorKey(e), lang), { action: { label: t.retry, onClick: retry } });
    },
    onSettled() {
      // This move still counts as in flight inside its own onSettled.
      if (qc.isMutating({ mutationKey: moveKey(projectId) }) !== 1) return;
      if (!failedBatch.get(qc)?.delete(projectId)) return;
      // fetchQuery writes the cache itself; no invalidation.
      qc.fetchQuery({
        queryKey: key,
        queryFn: () => api<BoardData>(`/projects/${projectId}/board`),
        staleTime: 0,
      }).catch(() => {});
    },
  };
}

/** Mirrors the server's completedAt rule so a card dropped into Done looks completed immediately. */
function applyMove(b: BoardData, v: MoveCardInput): BoardData {
  const card = b.cards.find((c) => c.id === v.cardId);
  const next = moveCardLocal(b, v);
  if (!card || card.listId === v.toListId) return next;
  const to = b.lists.find((l) => l.id === v.toListId);
  const from = b.lists.find((l) => l.id === card.listId);
  let completedAt = card.completedAt;
  if (to?.isDone) completedAt = completedAt ?? new Date().toISOString();
  else if (from?.isDone) completedAt = null;
  if (completedAt === card.completedAt) return next;
  return {
    ...next,
    cards: next.cards.map((c) => (c.id === v.cardId ? { ...c, completedAt } : c)),
  };
}

export function useMoveCard(projectId: number) {
  const qc = useQueryClient();
  const key = qk.board(projectId);
  const fail = useMoveFailure(projectId);
  const m = useMutation({
    mutationKey: moveKey(projectId),
    mutationFn: ({ cardId, toListId, beforeId, afterId }: MoveCardInput) =>
      api<S['CardDetail']>(`/cards/${cardId}/move`, {
        method: 'POST',
        json: { toListId, beforeId, afterId } satisfies S['MoveCardInput'],
      }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<BoardData>(key);
      if (prev) qc.setQueryData<BoardData>(key, applyMove(prev, v));
      return { prev };
    },
    onError: (e, v, ctx) => fail.onFail(e, ctx?.prev, () => m.mutate(v)),
    onSettled: fail.onSettled,
    onSuccess: (d) =>
      qc.setQueryData<BoardData>(key, (b) =>
        b
          ? upsertCard(
              b,
              detailToSummary(
                d,
                b.cards.find((c) => c.id === d.id),
              ),
            )
          : b,
      ),
  });
  return m;
}
