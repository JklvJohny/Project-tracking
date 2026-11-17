'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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

/**
 * Shared failure path of card and list moves: restore the snapshot, then either reload the board
 * (stale_order, someone else reordered) or offer a Retry that re-sends the same move.
 */
export function useMoveFailure(projectId: number) {
  const qc = useQueryClient();
  const { lang } = useLang();
  const t = useT(TEXT);
  return (e: unknown, prev: BoardData | undefined, retry: () => void) => {
    const key = qk.board(projectId);
    if (prev) qc.setQueryData(key, prev);
    if (errorKey(e) === 'stale_order') {
      // fetchQuery writes the cache itself; no invalidation, nothing awaited by the UI.
      qc.fetchQuery({
        queryKey: key,
        queryFn: () => api<BoardData>(`/projects/${projectId}/board`),
        staleTime: 0,
      }).catch(() => {});
      toast(errorText('stale_order', lang));
    } else {
      toast.error(errorText(errorKey(e), lang), {
        action: { label: t.retry, onClick: retry },
      });
    }
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
  const onFail = useMoveFailure(projectId);
  const m = useMutation({
    mutationFn: ({ cardId, toListId, beforeId, afterId }: MoveCardInput) =>
      api<S['CardDetail']>(`/cards/${cardId}/move`, {
        method: 'POST',
        json: { toListId, beforeId, afterId },
      }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<BoardData>(key);
      if (prev) qc.setQueryData<BoardData>(key, applyMove(prev, v));
      return { prev };
    },
    onError: (e, v, ctx) => onFail(e, ctx?.prev, () => m.mutate(v)),
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
