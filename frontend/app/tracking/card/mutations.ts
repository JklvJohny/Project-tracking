'use client';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { api } from '../shared/api/client';
import { qk } from '../shared/api/queries';
import type { components } from '../shared/api/schema';
import { errorMessage } from '../shared/errors';
import { useLang, useT } from '../shared/i18n';
import { bumpCommentCount, detailToSummary, setPreviewItemDone, upsertCard, type BoardData } from '../board/board-cache';

const TEXT = {
  th: { retry: 'ลองอีกครั้ง', notSaved: (m: string) => `บันทึกการแก้ไขในการ์ดไม่สำเร็จ: ${m}` },
  en: { retry: 'Retry', notSaved: (m: string) => `Your edit to the card was not saved: ${m}` },
};

/** True while the calling component is mounted. */
function useMounted() {
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}

/**
 * Reports a save that failed after its field was closed. An open field shows its own error next to it; one closed
 * mid-save (Escape, a click outside) flushes its draft on unmount and has nowhere left to show the error, so without
 * this the edit would vanish without a word. Retry sends the same change again.
 */
function useClosedFieldFailure<V>(key: string, resend: (vars: V) => Promise<unknown>) {
  const mounted = useMounted();
  const { lang } = useLang();
  const t = useT(TEXT);
  return (e: unknown, vars: V) => {
    if (mounted.current) return;
    toast.error(t.notSaved(errorMessage(e, lang)), {
      id: key,
      action: { label: t.retry, onClick: () => void resend(vars).catch((err) => toast.error(errorMessage(err, lang), { id: key })) },
    });
  };
}

type S = components['schemas'];
type Detail = S['CardDetail'];
type Item = S['ChecklistItem'];
type Comment = S['Comment'];

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
              ? {
                  ...c,
                  checklistTotal: next.length,
                  checklistDone: next.filter((i) => i.isDone).length,
                  // The board card shows the first three items by position; keep them in step with the panel.
                  // `next` is already in position order (the optimistic move reorders it before positions are known).
                  checklistPreview: next.slice(0, 3).map(({ id, text, isDone }) => ({ id, text, isDone })),
                }
              : c,
          ),
        }
      : b,
  );
}

export function useUpdateCard(projectId: number, cardId: number) {
  const qc = useQueryClient();
  const send = (input: S['UpdateCardInput']) =>
    api<Detail>(`/cards/${cardId}`, { method: 'PATCH', json: input satisfies S['UpdateCardInput'] });
  const closed = useClosedFieldFailure(`card-save-${cardId}`, (input: S['UpdateCardInput']) =>
    send(input).then((d) => putDetail(qc, projectId, d)),
  );
  return useMutation({ mutationFn: send, onSuccess: (d) => putDetail(qc, projectId, d), onError: closed });
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
    mutationFn: (input: S['LabelInput']) => api<S['Label']>(`/projects/${projectId}/labels`, { method: 'POST', json: input satisfies S['LabelInput'] }),
    onSuccess: (l) =>
      patchLabels(qc, projectId, (b) => ({ ...b, labels: [...b.labels, { id: l.id, name: l.name, color: l.color }] })),
  });
  const update = useMutation({
    mutationFn: ({ id, ...input }: { id: number } & S['LabelPatch']) =>
      api<S['Label']>(`/labels/${id}`, { method: 'PATCH', json: input satisfies S['LabelPatch'] }),
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

/** Reorders locally first (the list must not jump back while the request is in flight); a failure restores the snapshot, then refetches the card. */
export function useChecklist(projectId: number, cardId: number) {
  const qc = useQueryClient();
  const add = useMutation({
    mutationFn: (text: string) => api<Item>(`/cards/${cardId}/checklist`, { method: 'POST', json: { text } satisfies S['AddItemInput'] }),
    onSuccess: (item) => putChecklist(qc, projectId, cardId, (items) => [...items, item]),
  });
  const patchItem = ({ id, ...input }: { id: number } & S['ItemPatch']) =>
    api<Item>(`/checklist/${id}`, { method: 'PATCH', json: input satisfies S['ItemPatch'] });
  const putItem = (item: Item) => putChecklist(qc, projectId, cardId, (items) => items.map((i) => (i.id === item.id ? item : i)));
  const closed = useClosedFieldFailure(`checklist-save-${cardId}`, (vars: { id: number } & S['ItemPatch']) => patchItem(vars).then(putItem));
  const update = useMutation({ mutationFn: patchItem, onSuccess: putItem, onError: closed });
  const remove = useMutation({
    mutationFn: (id: number) => api<unknown>(`/checklist/${id}`, { method: 'DELETE' }),
    onSuccess: (_r, id) => putChecklist(qc, projectId, cardId, (items) => items.filter((i) => i.id !== id)),
  });
  const move = useMutation({
    mutationFn: ({ id, beforeId, afterId }: MoveItem) =>
      api<Item>(`/checklist/${id}/move`, { method: 'POST', json: { beforeId, afterId } satisfies S['MoveInput'] }),
    onMutate: async ({ id, beforeId, afterId }) => {
      // A refetch landing mid-move would overwrite the local order with the pre-move one.
      await qc.cancelQueries({ queryKey: qk.card(cardId) });
      const prev = { card: qc.getQueryData<Detail>(qk.card(cardId)), board: qc.getQueryData<BoardData>(qk.board(projectId)) };
      putChecklist(qc, projectId, cardId, (items) => {
        const item = items.find((i) => i.id === id);
        if (!item) return items;
        const rest = items.filter((i) => i.id !== id);
        const above = beforeId != null ? rest.findIndex((i) => i.id === beforeId) : -1;
        const below = afterId != null ? rest.findIndex((i) => i.id === afterId) : -1;
        const at = above >= 0 ? above + 1 : below >= 0 ? below : rest.length;
        return [...rest.slice(0, at), item, ...rest.slice(at)];
      });
      return prev;
    },
    // The response carries the new position only; order is already right locally.
    onSuccess: (item) => qc.setQueryData<Detail>(qk.card(cardId), (d) =>
      d ? { ...d, checklist: d.checklist.map((i) => (i.id === item.id ? item : i)) } : d),
    onError: (_e, _v, prev) => {
      if (prev?.card) qc.setQueryData(qk.card(cardId), prev.card);
      if (prev?.board) qc.setQueryData(qk.board(projectId), prev.board);
      // The server may have reordered meanwhile (stale_order): take its view of this card (not the board).
      void qc.invalidateQueries({ queryKey: qk.card(cardId) });
    },
  });
  /**
   * Undo of a delete: re-creates the item (done state included), then puts it back between the neighbours it had,
   * those still present. Neighbours read from the cache at undo time, since the list may have changed meanwhile.
   */
  const restore = async (item: Item, aboveId: number | null, belowId: number | null) => {
    let created = await add.mutateAsync(item.text);
    if (item.isDone) created = await update.mutateAsync({ id: created.id, isDone: true });
    const ids = new Set((qc.getQueryData<Detail>(qk.card(cardId))?.checklist ?? []).map((i) => i.id));
    const beforeId = aboveId !== null && ids.has(aboveId) ? aboveId : null;
    const afterId = belowId !== null && ids.has(belowId) ? belowId : null;
    // Created at the end: nothing to move when it was last (or its neighbours are gone).
    if (afterId !== null) await move.mutateAsync({ id: created.id, beforeId, afterId });
  };
  return { add, update, remove, move, restore };
}

function bumpBoard(qc: QueryClient, projectId: number, cardId: number, delta: number) {
  qc.setQueryData<BoardData>(qk.board(projectId), (b) => (b ? bumpCommentCount(b, cardId, delta) : b));
}

/** Comment writes patch the cached list from the server's answer (no refetch) and keep the board badge in step. */
export function useAddComment(projectId: number, cardId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (bodyMd: string) => api<Comment>(`/cards/${cardId}/comments`, { method: 'POST', json: { body: bodyMd } satisfies S['CommentInput'] }),
    onSuccess: (c) => {
      qc.setQueryData<Comment[]>(qk.comments(cardId), (list) =>
        list && !list.some((x) => x.id === c.id) ? [...list, c] : list,
      );
      bumpBoard(qc, projectId, cardId, 1);
    },
  });
}

export function useEditComment(cardId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, bodyMd }: { id: number; bodyMd: string }) =>
      api<Comment>(`/comments/${id}`, { method: 'PATCH', json: { body: bodyMd } satisfies S['CommentInput'] }),
    onSuccess: (c) => qc.setQueryData<Comment[]>(qk.comments(cardId), (list) => list?.map((x) => (x.id === c.id ? c : x))),
  });
}

export function useDeleteComment(projectId: number, cardId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<unknown>(`/comments/${id}`, { method: 'DELETE' }),
    onSuccess: (_r, id) => {
      qc.setQueryData<Comment[]>(qk.comments(cardId), (list) => list?.filter((x) => x.id !== id));
      bumpBoard(qc, projectId, cardId, -1);
    },
  });
}

/**
 * Ticks a checklist item straight from a board card. Optimistic on the board summary and on the card detail when it is
 * cached; a failure flips that one item back. No success toast (inline edit).
 */
export function useToggleChecklistItem(projectId: number) {
  const qc = useQueryClient();
  const { lang } = useLang();
  const t = useT(TEXT);
  const toggle = useMutation({
    mutationFn: ({ itemId, isDone }: { cardId: number; itemId: number; isDone: boolean }) =>
      api<Item>(`/checklist/${itemId}`, { method: 'PATCH', json: { isDone } satisfies S['ItemPatch'] }),
    onMutate: async ({ cardId, itemId, isDone }) => {
      await qc.cancelQueries({ queryKey: qk.board(projectId) });
      await qc.cancelQueries({ queryKey: qk.card(cardId) });
      qc.setQueryData<BoardData>(qk.board(projectId), (b) => (b ? setPreviewItemDone(b, cardId, itemId, isDone) : b));
      qc.setQueryData<Detail>(qk.card(cardId), (d) =>
        d ? { ...d, checklist: d.checklist.map((i) => (i.id === itemId ? { ...i, isDone } : i)) } : d,
      );
    },
    onError: (e, vars) => {
      const { cardId, itemId, isDone } = vars;
      // Undo only this tick. Restoring the snapshots from onMutate would also undo any other tick that succeeded
      // in the meantime, leaving the screen out of step with the server.
      qc.setQueryData<BoardData>(qk.board(projectId), (b) => (b ? setPreviewItemDone(b, cardId, itemId, !isDone) : b));
      qc.setQueryData<Detail>(qk.card(cardId), (d) =>
        d ? { ...d, checklist: d.checklist.map((i) => (i.id === itemId ? { ...i, isDone: !isDone } : i)) } : d,
      );
      // Per-item id: repeated failures replace one toast; Retry re-sends the same tick.
      toast.error(errorMessage(e, lang), { id: `checklist-${itemId}`, action: { label: t.retry, onClick: () => toggle.mutate(vars) } });
    },
  });
  return toggle;
}
