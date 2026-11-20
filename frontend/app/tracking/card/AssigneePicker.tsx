'use client';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useMe } from '../shared/api/queries';
import type { components } from '../shared/api/schema';
import { spanOf } from '../people/impact';
import { ImpactPanel } from '../people/ImpactPanel';
import { PersonLink } from '../people/PersonLink';
import { Avatar } from '../shared/Avatar';
import { useT } from '../shared/i18n';
import { SaveStatus, useInlineSave } from './inline';
import { useAssign } from './mutations';

type S = components['schemas'];

const TEXT = {
  th: { assignees: 'ผู้รับผิดชอบ', add: 'จัดการผู้รับผิดชอบ', search: 'ค้นหาสมาชิก', empty: 'ไม่พบสมาชิก', none: 'ยังไม่มีผู้รับผิดชอบ' },
  en: { assignees: 'Assignees', add: 'Manage assignees', search: 'Search members', empty: 'No members found', none: 'Nobody assigned' },
};

function Person({ id, name, avatarUrl }: { id: number; name: string; avatarUrl: string }) {
  return (
    <>
      <Avatar user={{ id, name, avatarUrl }} size="sm" />
      {/* The avatar already names them for screen readers. */}
      <span className="truncate" aria-hidden>
        {name}
      </span>
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
  const me = useMe();
  const [open, setOpen] = useState(false);
  // Admins and PMs see how a dated card lands on someone's schedule before adding them; everyone else, and cards
  // without dates (nothing to collide with), assign in one click as before.
  const span = spanOf(card);
  const canPreview = me.data?.canViewPeople === true && span !== null;
  const [preview, setPreview] = useState<S['BoardMember'] | null>(null);

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{t.assignees}</span>
      <div className="flex flex-wrap items-center gap-2">
        {assigned.length === 0 && <span className="text-sm text-muted-foreground">{t.none}</span>}
        <ul className="contents">
          {assigned.map((u) => (
            <li key={u.id} className="flex max-w-48 rounded-full bg-muted text-sm">
              <PersonLink userId={u.id} className="flex min-w-0 items-center gap-1.5 rounded-full py-0.5 pr-2.5 pl-0.5">
                <Person id={u.id} name={u.name} avatarUrl={u.avatarUrl} />
              </PersonLink>
            </li>
          ))}
        </ul>
        {!readOnly && (
          <Popover
            open={open}
            onOpenChange={(o) => {
              setOpen(o);
              if (!o) setPreview(null);
            }}
          >
            <PopoverTrigger asChild>
              <Button variant="outline" size="icon-sm" aria-label={t.add} title={t.add}>
                <Plus aria-hidden />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className={`p-0 ${preview ? 'w-[min(36rem,calc(100vw-2rem))]' : 'w-64'}`}>
              {preview && span ? (
                <ImpactPanel
                  userId={preview.userId}
                  name={preview.name}
                  avatarUrl={preview.avatarUrl}
                  card={{ id: card.id, title: card.title, span }}
                  onBack={() => setPreview(null)}
                  onAssign={() => {
                    void save({ userId: preview.userId, on: true });
                    setPreview(null);
                    setOpen(false);
                  }}
                />
              ) : (
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
                          onSelect={() => (!on && canPreview ? setPreview(m) : void save({ userId: m.userId, on: !on }))}
                        >
                          <Person id={m.userId} name={m.name} avatarUrl={m.avatarUrl} />
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </CommandList>
              </Command>
              )}
            </PopoverContent>
          </Popover>
        )}
      </div>
      {!readOnly && <SaveStatus state={state} />}
    </div>
  );
}
