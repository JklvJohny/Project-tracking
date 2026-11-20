'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useMembers } from '../projects/project-mutations';
import { Avatar } from '../shared/Avatar';
import { useConfirm } from '../shared/confirm';
import { errorMessage } from '../shared/errors';
import { useLang, useT } from '../shared/i18n';
import { useUserSearch } from '../shared/useUserSearch';
import { useShare, useShares, useUnshare, type Folder } from './queries';

const TEXT = {
  th: {
    title: (n: string) => `แชร์โฟลเดอร์ ${n}`,
    desc: 'คนนอกโปรเจกต์จะเห็นโฟลเดอร์นี้เมื่อแชร์ให้เท่านั้น เขาดู ดาวน์โหลด และอัปโหลดรายงานได้ ลบได้เฉพาะไฟล์ของตัวเอง และไม่เห็นบอร์ดของโปรเจกต์',
    search: 'ค้นหาคน',
    searchPlaceholder: 'พิมพ์ชื่อเพื่อค้นหา',
    noResults: 'ไม่พบคน',
    share: 'แชร์',
    shareWith: (n: string) => `แชร์กับ ${n}`,
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
    desc: "People outside the project see this folder only once it is shared with them. They can view, download and upload reports and delete their own, but not see the project's board.",
    search: 'Search people',
    searchPlaceholder: 'Type a name to search',
    noResults: 'No one found',
    share: 'Share',
    shareWith: (n: string) => `Share with ${n}`,
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.title(folder.name)}</DialogTitle>
          <DialogDescription>{t.desc}</DialogDescription>
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
  const [q, setQ] = useState('');
  // The error itself, not its text: the message is resolved at render so it follows a language switch.
  const [error, setError] = useState<unknown>(null);
  const found = useUserSearch(q);
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
      <Input type="search" aria-label={t.search} placeholder={t.searchPlaceholder} value={q} onChange={(e) => setQ(e.target.value)} />
      {found && (
        <ul className="max-h-48 divide-y overflow-y-auto rounded-md border">
          {found.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">{t.noResults}</li>}
          {found.map((u) => (
            <li key={u.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
              <Avatar user={u} size="xs" />
              <span className="min-w-0 flex-1 truncate" aria-hidden>
                {u.name}
              </span>
              {isMember(u.id) ? (
                <span className="shrink-0 text-xs text-muted-foreground">{t.member}</span>
              ) : isShared(u.id) ? (
                <span className="shrink-0 text-xs text-muted-foreground">{t.shared}</span>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={t.shareWith(u.name)}
                  disabled={share.isPending || members.isPending}
                  onClick={() => {
                    setError(null);
                    share.mutate(u.id, { onSuccess: () => setQ(''), onError: setError });
                  }}
                >
                  {t.share}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
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
                  <Avatar user={{ id: s.userId, name, avatarUrl: s.avatarUrl }} size="xs" />
                  <span className="min-w-0 flex-1 truncate" aria-hidden>
                    {name}
                  </span>
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
