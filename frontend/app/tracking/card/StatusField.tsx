'use client';
import { useQueryClient } from '@tanstack/react-query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useMoveCard } from '../board/useMoveCard';
import { qk } from '../shared/api/queries';
import type { components } from '../shared/api/schema';
import { useT } from '../shared/i18n';

type S = components['schemas'];

const TEXT = { th: { status: 'สถานะ (ลิสต์)' }, en: { status: 'Status (list)' } };

/**
 * Status is the card's list: choosing one moves the card to the END of that list through the board's own move hook
 * (optimistic board update, rollback and stale_order handling live there). The detail cache follows the move so the
 * select and the breadcrumb agree, and goes back if the move fails.
 */
export function StatusField({
  projectId,
  card,
  lists,
  cards,
  readOnly,
}: {
  projectId: number;
  card: S['CardDetail'];
  lists: S['List'][];
  cards: S['CardSummary'][];
  readOnly: boolean;
}) {
  const t = useT(TEXT);
  const qc = useQueryClient();
  const move = useMoveCard(projectId);
  const current = lists.find((l) => l.id === card.listId);
  const open = lists.filter((l) => !l.archivedAt);

  async function choose(value: string) {
    const toListId = Number(value);
    if (toListId === card.listId) return;
    // Board order is display order: the last card of the target list that is not this card.
    const last = cards.filter((c) => c.listId === toListId && c.id !== card.id).at(-1);
    const key = qk.card(card.id);
    const setList = (listId: number) =>
      qc.setQueryData<S['CardDetail']>(key, (d) => (d ? { ...d, listId } : d));
    const from = card.listId;
    setList(toListId);
    try {
      await move.mutateAsync({ cardId: card.id, toListId, beforeId: last?.id ?? null, afterId: null });
    } catch {
      // The hook already rolled the board back and toasted.
      setList(from);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{t.status}</span>
      {readOnly ? (
        <p className="text-sm">{current?.name}</p>
      ) : (
        <Select value={String(card.listId)} onValueChange={(v) => void choose(v)}>
          <SelectTrigger aria-label={t.status} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {open.map((l) => (
              <SelectItem key={l.id} value={String(l.id)}>
                {l.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
