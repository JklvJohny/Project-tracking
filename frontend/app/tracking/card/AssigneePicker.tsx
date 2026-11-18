'use client';
import { Plus } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { components } from '../shared/api/schema';
import { useT } from '../shared/i18n';
import { SaveStatus, useInlineSave } from './inline';
import { useAssign } from './mutations';

type S = components['schemas'];

const TEXT = {
  th: { assignees: 'ผู้รับผิดชอบ', add: 'จัดการผู้รับผิดชอบ', search: 'ค้นหาสมาชิก', empty: 'ไม่พบสมาชิก', none: 'ยังไม่มีผู้รับผิดชอบ' },
  en: { assignees: 'Assignees', add: 'Manage assignees', search: 'Search members', empty: 'No members found', none: 'Nobody assigned' },
};

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => Array.from(w)[0] ?? '')
    .join('')
    .toUpperCase();

function Person({ name, avatarUrl }: { name: string; avatarUrl: string }) {
  return (
    <>
      <Avatar className="size-6">
        {avatarUrl && <AvatarImage src={avatarUrl} alt="" />}
        <AvatarFallback className="text-[10px]">{initials(name)}</AvatarFallback>
      </Avatar>
      <span className="truncate">{name}</span>
    </>
  );
}

export function AssigneePicker({
  projectId,
  card,
  members,
  users,
  readOnly,
}: {
  projectId: number;
  card: S['CardDetail'];
  members: S['BoardMember'][];
  users: S['User'][];
  readOnly: boolean;
}) {
  const t = useT(TEXT);
  const assign = useAssign(projectId, card.id);
  const { state, save } = useInlineSave(assign.mutateAsync);
  const assigned = card.assigneeIds.map((id) => users.find((u) => u.id === id)).filter((u) => !!u);

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{t.assignees}</span>
      <div className="flex flex-wrap items-center gap-2">
        {assigned.length === 0 && <span className="text-sm text-muted-foreground">{t.none}</span>}
        <ul className="contents">
          {assigned.map((u) => (
            <li key={u.id} className="flex max-w-48 items-center gap-1.5 rounded-full bg-muted py-0.5 pr-2.5 pl-0.5 text-sm">
              <Person name={u.name} avatarUrl={u.avatarUrl} />
            </li>
          ))}
        </ul>
        {!readOnly && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="icon-sm" aria-label={t.add} title={t.add}>
                <Plus aria-hidden />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-0">
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
                          onSelect={() => void save({ userId: m.userId, on: !on })}
                        >
                          <Person name={m.name} avatarUrl={m.avatarUrl} />
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        )}
      </div>
      {!readOnly && <SaveStatus state={state} />}
    </div>
  );
}
