'use client';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '../shared/api/client';
import { qk } from '../shared/api/queries';
import type { components } from '../shared/api/schema';
import { detailToSummary, upsertCard, type BoardData } from '../board/board-cache';

type S = components['schemas'];
type Detail = S['CardDetail'];
type Item = S['ChecklistItem'];

// Card writes patch two caches from the server's answer: the detail (qk.card) and the board summary.
// The board is never invalidated; a board that is not cached is left alone.

function putDetail(qc: QueryClient, projectId: number, d: Detail) {
  qc.setQueryData(qk.card(d.id), d);
  qc.setQueryData<BoardData>(qk.board(projectId), (b) =>
    b ? upsertCard(b, detailToSummary(d, b.cards.find((c) => c.id === d.id))) : b,
  );
}

/** Applies a checklist change to the cached detail and mirrors the counts onto the board summary. */
function putChecklist(qc: QueryClient, projectId: number, cardId: number, fn: (items: Item[]) => Item[]) {
  const d = qc.getQueryData<Detail>(qk.card(cardId));
  if (d) qc.setQueryData<Detail>(qk.card(cardId), { ...d, checklist: fn(d.checklist) });
  const next = qc.getQueryData<Detail>(qk.card(cardId))?.checklist;
  if (!next) return;
  qc.setQueryData<BoardData>(qk.board(projectId), (b) =>
    b
      ? {
          ...b,
          cards: b.cards.map((c) =>
            c.id === cardId
              ? { ...c, checklistTotal: next.length, checklistDone: next.filter((i) => i.isDone).length }
              : c,
          ),
        }
      : b,
  );
}

export function useUpdateCard(projectId: number, cardId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: S['UpdateCardInput']) => api<Detail>(`/cards/${cardId}`, { method: 'PATCH', json: input }),
    onSuccess: (d) => putDetail(qc, projectId, d),
  });
}

export function useAssign(projectId: number, cardId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, on }: { userId: number; on: boolean }) =>
      api<Detail>(`/cards/${cardId}/assignees/${userId}`, { method: on ? 'PUT' : 'DELETE' }),
    onSuccess: (d) => putDetail(qc, projectId, d),
  });
}

export function useCardLabel(projectId: number, cardId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ labelId, on }: { labelId: number; on: boolean }) =>
      api<Detail>(`/cards/${cardId}/labels/${labelId}`, { method: on ? 'PUT' : 'DELETE' }),
    onSuccess: (d) => putDetail(qc, projectId, d),
  });
}

function patchLabels(qc: QueryClient, projectId: number, fn: (b: BoardData) => BoardData) {
  qc.setQueryData<BoardData>(qk.board(projectId), (b) => (b ? fn(b) : b));
}

export function useLabelCrud(projectId: number) {
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: (input: S['LabelInput']) => api<S['Label']>(`/projects/${projectId}/labels`, { method: 'POST', json: input }),
    onSuccess: (l) =>
      patchLabels(qc, projectId, (b) => ({ ...b, labels: [...b.labels, { id: l.id, name: l.name, color: l.color }] })),
  });
  const update = useMutation({
    mutationFn: ({ id, ...input }: { id: number } & S['LabelPatch']) =>
      api<S['Label']>(`/labels/${id}`, { method: 'PATCH', json: input }),
    onSuccess: (l) =>
      patchLabels(qc, projectId, (b) => ({
        ...b,
        labels: b.labels.map((x) => (x.id === l.id ? { id: l.id, name: l.name, color: l.color } : x)),
      })),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api<unknown>(`/labels/${id}`, { method: 'DELETE' }),
    onSuccess: (_r, id) => {
      patchLabels(qc, projectId, (b) => ({
        ...b,
        labels: b.labels.filter((l) => l.id !== id),
        cards: b.cards.map((c) => (c.labelIds.includes(id) ? { ...c, labelIds: c.labelIds.filter((x) => x !== id) } : c)),
      }));
      // Cached details of other cards still list the label id; harmless to render (unknown ids are skipped)
      // but strip it so a later edit does not resend stale data.
      for (const [key, d] of qc.getQueriesData<Detail>({ queryKey: ['card'] }))
        if (d?.labelIds.includes(id)) qc.setQueryData<Detail>(key, { ...d, labelIds: d.labelIds.filter((x) => x !== id) });
    },
  });
  return { create, update, remove };
}

export type MoveItem = { id: number; beforeId: number | null; afterId: number | null };

/** Reorders locally first (the list must not jump back while the request is in flight), refetches the card on failure. */
export function useChecklist(projectId: number, cardId: number) {
  const qc = useQueryClient();
  const add = useMutation({
    mutationFn: (text: string) => api<Item>(`/cards/${cardId}/checklist`, { method: 'POST', json: { text } }),
    onSuccess: (item) => putChecklist(qc, projectId, cardId, (items) => [...items, item]),
  });
  const update = useMutation({
    mutationFn: ({ id, ...input }: { id: number } & S['ItemPatch']) =>
      api<Item>(`/checklist/${id}`, { method: 'PATCH', json: input }),
    onSuccess: (item) => putChecklist(qc, projectId, cardId, (items) => items.map((i) => (i.id === item.id ? item : i))),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api<unknown>(`/checklist/${id}`, { method: 'DELETE' }),
    onSuccess: (_r, id) => putChecklist(qc, projectId, cardId, (items) => items.filter((i) => i.id !== id)),
  });
  const move = useMutation({
    mutationFn: ({ id, beforeId, afterId }: MoveItem) =>
      api<Item>(`/checklist/${id}/move`, { method: 'POST', json: { beforeId, afterId } }),
    onMutate: ({ id, beforeId, afterId }) => {
      putChecklist(qc, projectId, cardId, (items) => {
        const item = items.find((i) => i.id === id);
        if (!item) return items;
        const rest = items.filter((i) => i.id !== id);
        const above = beforeId != null ? rest.findIndex((i) => i.id === beforeId) : -1;
        const below = afterId != null ? rest.findIndex((i) => i.id === afterId) : -1;
        const at = above >= 0 ? above + 1 : below >= 0 ? below : rest.length;
        return [...rest.slice(0, at), item, ...rest.slice(at)];
      });
    },
    // The response carries the new position only; order is already right locally.
    onSuccess: (item) => qc.setQueryData<Detail>(qk.card(cardId), (d) =>
      d ? { ...d, checklist: d.checklist.map((i) => (i.id === item.id ? item : i)) } : d),
    onError: () => qc.invalidateQueries({ queryKey: qk.card(cardId) }),
  });
  return { add, update, remove, move };
}
