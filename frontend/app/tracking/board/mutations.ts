'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../shared/api/client';
import { qk } from '../shared/api/queries';
import type { components } from '../shared/api/schema';
import { errorMessage } from '../shared/errors';
import { useLang, useT } from '../shared/i18n';
import {
  detailToSummary,
  removeCard,
  setListCompletion,
  upsertCard,
  upsertList,
  type BoardData,
  type CardSummary,
} from './board-cache';

type S = components['schemas'];

const TEXT = {
  th: { cardArchived: 'เก็บการ์ดถาวรแล้ว', undo: 'เลิกทำ' },
  en: { cardArchived: 'Card archived', undo: 'Undo' },
};

/** Board writes patch the cached snapshot with the entity the server returned; the board is never invalidated. */
function usePatchBoard(projectId: number) {
  const qc = useQueryClient();
  return (fn: (b: BoardData) => BoardData) => qc.setQueryData<BoardData>(qk.board(projectId), (b) => (b ? fn(b) : b));
}

export function useCreateList(projectId: number) {
  const patch = usePatchBoard(projectId);
  return useMutation({
    mutationFn: (name: string) => api<S['List']>(`/projects/${projectId}/lists`, { method: 'POST', json: { name } }),
    onSuccess: (l) => patch((b) => upsertList(b, l)),
  });
}

export function useUpdateList(projectId: number) {
  const patch = usePatchBoard(projectId);
  const { lang } = useLang();
  return useMutation({
    mutationFn: ({ listId, ...input }: { listId: number } & S['UpdateListInput']) =>
      api<S['List']>(`/lists/${listId}`, { method: 'PATCH', json: input }),
    onSuccess: (l, v) =>
      patch((b) => {
        const next = upsertList(b, l);
        return v.isDone === undefined ? next : setListCompletion(next, l.id, l.isDone ? new Date().toISOString() : null);
      }),
    onError: (e) => toast.error(errorMessage(e, lang)),
  });
}

export function useArchiveList(projectId: number) {
  const patch = usePatchBoard(projectId);
  const qc = useQueryClient();
  const { lang } = useLang();
  return useMutation({
    mutationFn: (listId: number) => api<S['List']>(`/lists/${listId}/archive`, { method: 'POST' }),
    onSuccess: (l) => {
      patch((b) => upsertList(b, l));
      qc.invalidateQueries({ queryKey: qk.archived(projectId) });
    },
    onError: (e) => toast.error(errorMessage(e, lang)),
  });
}

export function useRestoreList(projectId: number) {
  const qc = useQueryClient();
  const { lang } = useLang();
  return useMutation({
    mutationFn: async (listId: number) => {
      await api<S['List']>(`/lists/${listId}/restore`, { method: 'POST' });
      // A restored list brings back cards the cache dropped on archive, and the response carries none.
      // Replace the snapshot with a fresh one (setQueryData, not an invalidation).
      return api<BoardData>(`/projects/${projectId}/board`);
    },
    onSuccess: (b) => {
      qc.setQueryData(qk.board(projectId), b);
      qc.invalidateQueries({ queryKey: qk.archived(projectId) });
    },
    onError: (e) => toast.error(errorMessage(e, lang)),
  });
}

export function useCreateCard(projectId: number) {
  const patch = usePatchBoard(projectId);
  return useMutation({
    mutationFn: ({ listId, title }: { listId: number; title: string }) =>
      api<S['CardDetail']>(`/lists/${listId}/cards`, { method: 'POST', json: { title } }),
    onSuccess: (d) => patch((b) => upsertCard(b, detailToSummary(d))),
  });
}

export function useRestoreCard(projectId: number) {
  const patch = usePatchBoard(projectId);
  const qc = useQueryClient();
  const { lang } = useLang();
  return useMutation({
    mutationFn: ({ card }: { card: CardSummary }) => api<S['CardDetail']>(`/cards/${card.id}/restore`, { method: 'POST' }),
    onSuccess: (d, { card }) => {
      patch((b) => upsertCard(b, detailToSummary(d, card)));
      qc.invalidateQueries({ queryKey: qk.archived(projectId) });
    },
    onError: (e) => toast.error(errorMessage(e, lang)),
  });
}

/** Removes the card, then offers Undo (restore) in a toast. */
export function useArchiveCard(projectId: number) {
  const patch = usePatchBoard(projectId);
  const qc = useQueryClient();
  const { lang } = useLang();
  const t = useT(TEXT);
  const restore = useRestoreCard(projectId);
  return useMutation({
    mutationFn: (card: CardSummary) => api<S['CardDetail']>(`/cards/${card.id}/archive`, { method: 'POST' }),
    onSuccess: (_d, card) => {
      patch((b) => removeCard(b, card.id));
      qc.invalidateQueries({ queryKey: qk.archived(projectId) });
      toast(t.cardArchived, { action: { label: t.undo, onClick: () => restore.mutate({ card }) } });
    },
    onError: (e) => toast.error(errorMessage(e, lang)),
  });
}

/** Archived lists and cards, fetched only while the sheet is open. */
export function useArchived(projectId: number, enabled: boolean) {
  return useQuery({
    queryKey: qk.archived(projectId),
    queryFn: () => api<S['Archived']>(`/projects/${projectId}/archived`),
    enabled,
  });
}
