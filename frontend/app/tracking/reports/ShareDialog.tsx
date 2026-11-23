'use client';
import { Check, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useMembers } from '../projects/project-mutations';
import { useTeam } from '../team/queries';
import { Avatar } from '../shared/Avatar';
import { useConfirm } from '../shared/confirm';
import { errorMessage } from '../shared/errors';
import { useLang, useT } from '../shared/i18n';
import { useShare, useShares, useUnshare, type Folder } from './queries';
import { PersonLink } from '../people/PersonLink';

const TEXT = {
  th: {
    title: (n: string) => `แชร์โฟลเดอร์ ${n}`,
    pick: 'เลือกคนที่จะแชร์ให้',
    search: 'ค้นหาชื่อ',
    noResults: 'ไม่พบคน',
    member: 'สมาชิกโปรเจกต์',
    shared: 'แชร์แล้ว',
    list: 'แชร์กับ',
    none: 'ยังไม่ได้แชร์กับใคร',
    loading: 'กำลังโหลด…',
    unknown: 'ผู้ใช้ไม่ทราบชื่อ',
    stop: 'หยุดแชร์',
    stopWith: (n: string) => `หยุดแชร์กับ ${n}`,
    stopTitle: (n: string) => `หยุดแชร์โฟลเดอร์กับ ${n}?`,
    stopDesc: 'เขาจะไม่เห็นโฟลเดอร์นี้อีก ไฟล์ที่เขาอัปโหลดไว้ยังอยู่ในโฟลเดอร์',
  },
  en: {
    title: (n: string) => `Share the ${n} folder`,
    pick: 'Choose people to share with',
    search: 'Search names',
    noResults: 'No one found',
    member: 'Project member',
    shared: 'Shared',
    list: 'Shared with',
    none: 'Not shared with anyone yet',
    loading: 'Loading…',
    unknown: 'Unknown user',
    stop: 'Stop sharing',
    stopWith: (n: string) => `Stop sharing with ${n}`,
    stopTitle: (n: string) => `Stop sharing this folder with ${n}?`,
    stopDesc: 'They will no longer see this folder. Files they uploaded stay in it.',
  },
};

export function ShareDialog({ folder, open, onOpenChange }: { folder: Folder; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT(TEXT);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t.title(folder.name)}</DialogTitle>
        </DialogHeader>
        {open && <ShareBody projectId={folder.id} />}
      </DialogContent>
    </Dialog>
  );
}

function ShareBody({ projectId }: { projectId: number }) {
  const t = useT(TEXT);
  const { lang } = useLang();
  const confirm = useConfirm();
  const shares = useShares(projectId, true);
  const members = useMembers(projectId, true);
  const share = useShare(projectId);
  const unshare = useUnshare(projectId);
  const team = useTeam();
  const [picking, setPicking] = useState(false);
  // The error itself, not its text: the message is resolved at render so it follows a language switch.
  const [error, setError] = useState<unknown>(null);
  const list = shares.data ?? [];
  const isMember = (id: number) => members.data?.some((m) => m.userId === id) ?? false;
  const isShared = (id: number) => list.some((s) => s.userId === id);

  async function onStop(userId: number, name: string) {
    setError(null);
    if (!(await confirm({ title: t.stopTitle(name), description: t.stopDesc, confirmLabel: t.stop, destructive: true }))) return;
    unshare.mutate(userId, { onError: setError });
  }

  return (
    <div className="space-y-4">
      {/* A pop-up list of the whole department: pick one or several without typing a name first. */}
      <Popover open={picking} onOpenChange={setPicking}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-full justify-start text-muted-foreground">
            <UserPlus aria-hidden />
            {t.pick}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-64 p-0">
          <Command>
            <CommandInput placeholder={t.search} aria-label={t.search} />
            <CommandList>
              {team.isPending || members.isPending ? (
                <p className="px-3 py-2 text-sm text-muted-foreground">{t.loading}</p>
              ) : (
                <>
                  <CommandEmpty>{t.noResults}</CommandEmpty>
                  <CommandGroup>
                    {(team.data?.people ?? []).map((p) => {
                      const member = isMember(p.userId);
                      const shared = isShared(p.userId);
                      return (
                        <CommandItem
                          key={p.userId}
                          value={`${p.name} ${p.userId}`}
                          disabled={member || shared || share.isPending}
                          onSelect={() => {
                            setError(null);
                            share.mutate(p.userId, { onError: setError });
                          }}
                        >
                          <Avatar user={{ id: p.userId, name: p.name, avatarUrl: p.avatarUrl }} size="xs" />
                          <span className="min-w-0 flex-1 truncate" aria-hidden>
                            {p.name}
                          </span>
                          {member ? (
                            <span className="shrink-0 text-xs text-muted-foreground">{t.member}</span>
                          ) : shared ? (
                            <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                              <Check className="size-3.5" aria-hidden />
                              {t.shared}
                            </span>
                          ) : null}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {error != null && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {errorMessage(error, lang)}
        </p>
      )}
      <section aria-label={t.list}>
        <h3 className="mb-1 text-xs font-medium text-muted-foreground">{t.list}</h3>
        {shares.isPending ? (
          <p className="text-sm text-muted-foreground">{t.loading}</p>
        ) : shares.isError ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {errorMessage(shares.error, lang)}
          </p>
        ) : list.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.none}</p>
        ) : (
          <ul className="divide-y">
            {list.map((s) => {
              const name = s.name || `${t.unknown} #${s.userId}`;
              return (
                <li key={s.userId} className="flex items-center gap-2 py-2 text-sm">
                  <PersonLink userId={s.userId} className="flex min-w-0 flex-1 items-center gap-2">
                    <Avatar user={{ id: s.userId, name, avatarUrl: s.avatarUrl }} size="xs" />
                    <span className="min-w-0 truncate" aria-hidden>
                      {name}
                    </span>
                  </PersonLink>
                  <Button size="sm" variant="ghost" aria-label={t.stopWith(name)} disabled={unshare.isPending} onClick={() => onStop(s.userId, name)}>
                    {t.stop}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
