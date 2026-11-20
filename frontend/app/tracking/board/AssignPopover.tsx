'use client';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useAssign } from '../card/mutations';
import type { components } from '../shared/api/schema';
import { Avatar } from '../shared/Avatar';
import { errorMessage } from '../shared/errors';
import { useLang, useT } from '../shared/i18n';
import { stopDrag } from './stopDrag';

type S = components['schemas'];

const TEXT = {
  th: { add: 'เพิ่มผู้รับผิดชอบ', search: 'ค้นหาสมาชิก', empty: 'ไม่พบสมาชิก', retry: 'ลองอีกครั้ง' },
  en: { add: 'Add assignee', search: 'Search members', empty: 'No members found', retry: 'Retry' },
};

/**
 * The dashed "+" of a board card: the same member list and PUT/DELETE as the card panel's AssigneePicker, driven by
 * the board summary so it works without the card detail loaded. Events stop here so the row never drags or opens.
 */
export function AssignPopover({
  projectId,
  card,
  members,
}: {
  projectId: number;
  card: S['CardSummary'];
  members: S['BoardMember'][];
}) {
  const t = useT(TEXT);
  const { lang } = useLang();
  const assign = useAssign(projectId, card.id);
  const toggle = (userId: number, on: boolean) =>
    assign.mutate(
      { userId, on },
      {
        // One toast per card+member: a second failure replaces the first instead of stacking.
        onError: (e) =>
          toast.error(errorMessage(e, lang), { id: `assign-${card.id}-${userId}`, action: { label: t.retry, onClick: () => toggle(userId, on) } }),
      },
    );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t.add}
          title={t.add}
          {...stopDrag}
          className="inline-flex size-6 items-center justify-center rounded-full border border-dashed border-muted-foreground/60 bg-card text-muted-foreground transition-colors hover:border-primary hover:text-primary"
        >
          <Plus className="size-3.5" aria-hidden />
        </button>
      </PopoverTrigger>
      {/* Portalled content still bubbles through the React tree to the sortable row: keep typing and clicks local. */}
      <PopoverContent align="start" className="w-64 p-0" {...stopDrag}>
        <Command>
          <CommandInput placeholder={t.search} aria-label={t.search} />
          <CommandList>
            <CommandEmpty>{t.empty}</CommandEmpty>
            <CommandGroup>
              {members.map((m) => {
                const on = card.assigneeIds.includes(m.userId);
                return (
                  <CommandItem
                    key={m.userId}
                    value={`${m.name} ${m.userId}`}
                    data-checked={on}
                    aria-checked={on}
                    onSelect={() => toggle(m.userId, !on)}
                  >
                    <Avatar user={{ id: m.userId, name: m.name, avatarUrl: m.avatarUrl }} size="sm" />
                    <span className="truncate">{m.name}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
