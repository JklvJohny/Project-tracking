'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../shared/api/client';
import { qk } from '../shared/api/queries';
import type { components } from '../shared/api/schema';
import { moveListLocal, upsertList, type BoardData } from './board-cache';
import { useMoveFailure } from './useMoveCard';

type S = components['schemas'];
export type MoveListInput = {
  listId: number;
  beforeId?: number | null;
  afterId?: number | null;
};

/** Optimistic list reorder; same rollback / stale_order / retry behaviour as useMoveCard. */
export function useMoveList(projectId: number) {
  const qc = useQueryClient();
  const key = qk.board(projectId);
  const onFail = useMoveFailure(projectId);
  const m = useMutation({
    mutationFn: ({ listId, beforeId, afterId }: MoveListInput) =>
      api<S['List']>(`/lists/${listId}/move`, {
        method: 'POST',
        json: { beforeId, afterId },
      }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<BoardData>(key);
      if (prev) qc.setQueryData<BoardData>(key, moveListLocal(prev, v));
      return { prev };
    },
    onError: (e, v, ctx) => onFail(e, ctx?.prev, () => m.mutate(v)),
    onSuccess: (l) => qc.setQueryData<BoardData>(key, (b) => (b ? upsertList(b, l) : b)),
  });
  return m;
}
