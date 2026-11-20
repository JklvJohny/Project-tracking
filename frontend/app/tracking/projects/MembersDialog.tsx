'use client';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '../shared/api/client';
import { useBoard, useMe } from '../shared/api/queries';
import type { components } from '../shared/api/schema';
import { useConfirm } from '../shared/confirm';
import { errorMessage } from '../shared/errors';
import { useLang, useT } from '../shared/i18n';
import { routes } from '../shared/routes';
import { dropProject, useAddMember, useMembers, useRemoveMember, useSetRole } from './project-mutations';

type S = components['schemas'];
type Role = S['ProjectRole'];
const ROLES: Role[] = ['pm', 'member', 'viewer'];
const DEBOUNCE_MS = 250;

const TEXT = {
  th: {
    title: 'สมาชิกโปรเจกต์',
    desc: 'เพิ่ม เปลี่ยนบทบาท หรือนำสมาชิกออก',
    archivedDesc: 'โปรเจกต์นี้ถูกเก็บถาวร รายชื่อสมาชิกดูได้อย่างเดียว',
    search: 'ค้นหาคน',
    searchPlaceholder: 'พิมพ์ชื่อเพื่อค้นหา',
    newRole: 'บทบาทของสมาชิกใหม่',
    add: (n: string) => `เพิ่ม ${n}`,
    roleOf: (n: string) => `บทบาทของ ${n}`,
    remove: (n: string) => `นำ ${n} ออก`,
    removeTitle: (n: string) => `นำ ${n} ออกจากโปรเจกต์?`,
    removeDesc: 'สมาชิกจะไม่เห็นโปรเจกต์นี้อีก',
    removeOk: 'นำออก',
    removed: 'นำสมาชิกออกแล้ว',
    noResults: 'ไม่พบคน',
    loading: 'กำลังโหลด…',
    members: 'สมาชิก',
    roles: { pm: 'PM', member: 'สมาชิก', viewer: 'ผู้ชม' } as Record<Role, string>,
  },
  en: {
    title: 'Project members',
    desc: 'Add people, change roles, or remove members.',
    archivedDesc: 'This project is archived, so members are read-only.',
    search: 'Search people',
    searchPlaceholder: 'Type a name to search',
    newRole: 'Role for new member',
    add: (n: string) => `Add ${n}`,
    roleOf: (n: string) => `Role of ${n}`,
    remove: (n: string) => `Remove ${n}`,
    removeTitle: (n: string) => `Remove ${n} from this project?`,
    removeDesc: 'They will no longer see this project.',
    removeOk: 'Remove',
    removed: 'Member removed',
    noResults: 'No one found',
    loading: 'Loading…',
    members: 'Members',
    roles: { pm: 'PM', member: 'Member', viewer: 'Viewer' } as Record<Role, string>,
  },
};

/** Debounced search. A cleanup flag drops any response that is no longer the latest request. */
function useUserSearch(q: string) {
  const [state, setState] = useState<{ q: string; users: S['User'][] } | null>(null);
  useEffect(() => {
    const term = q.trim();
    if (!term) return;
    const ctl = new AbortController();
    let stale = false;
    const timer = setTimeout(() => {
      api<S['User'][]>(`/users?q=${encodeURIComponent(term)}`, { signal: ctl.signal })
        .then((users) => !stale && setState({ q: term, users }))
        .catch(() => !stale && setState({ q: term, users: [] }));
    }, DEBOUNCE_MS);
    return () => {
      stale = true;
      ctl.abort();
      clearTimeout(timer);
    };
  }, [q]);
  // Results of an older term are never shown for the current one.
  return q.trim() && state?.q === q.trim() ? state.users : null;
}

export function MembersDialog({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: number;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <MembersBody projectId={projectId} onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}

function MembersBody({ projectId, onOpenChange }: { projectId: number; onOpenChange: (o: boolean) => void }) {
  const t = useT(TEXT);
  const { lang } = useLang();
  const router = useRouter();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const me = useMe();
  const board = useBoard(projectId);
  // An archived project is read-only: the list stays visible, every control is off.
  const readOnly = !!board.data?.project.archivedAt;
  const members = useMembers(projectId, true);
  const add = useAddMember(projectId);
  const setRole = useSetRole(projectId);
  const remove = useRemoveMember(projectId);
  const [q, setQ] = useState('');
  const [newRole, setNewRole] = useState<Role>('member');
  // The error itself, not its text: the message is resolved at render so it follows a language switch.
  const [error, setError] = useState<unknown>(null);
  const found = useUserSearch(q);

  const list = members.data ?? [];
  const results = found?.filter((u) => !list.some((m) => m.userId === u.id));
  const fail = (e: unknown) => setError(e);

  function onAdd(u: S['User']) {
    setError(null);
    add.mutate({ userId: u.id, role: newRole }, { onSuccess: () => setQ(''), onError: fail });
  }

  function onRole(m: S['Member'], role: Role) {
    if (role === m.role) return;
    setError(null);
    setRole.mutate({ userId: m.userId, role }, { onError: fail });
  }

  async function onRemove(m: S['Member']) {
    setError(null);
    const ok = await confirm({
      title: t.removeTitle(m.name),
      description: t.removeDesc,
      confirmLabel: t.removeOk,
      destructive: true,
    });
    if (!ok) return;
    remove.mutate(m.userId, {
      onSuccess: () => {
        toast.success(t.removed);
        // Without admin rights the project is gone for you now.
        if (m.userId === me.data?.user.id && board.data?.myRole !== 'admin') {
          dropProject(qc, projectId);
          onOpenChange(false);
          router.replace(routes.projects);
        }
      },
      onError: fail,
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t.title}</DialogTitle>
        <DialogDescription>{readOnly ? t.archivedDesc : t.desc}</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        {!readOnly && (
          <div className="flex gap-2">
            <Input
              type="search"
              aria-label={t.search}
              placeholder={t.searchPlaceholder}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <Select value={newRole} onValueChange={(v) => setNewRole(v as Role)}>
              <SelectTrigger aria-label={t.newRole} className="w-36 shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {t.roles[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {!readOnly && results && (
          <ul className="max-h-40 divide-y overflow-y-auto rounded-md border">
            {results.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">{t.noResults}</li>}
            {results.map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
                <span className="truncate">{u.name}</span>
                <Button size="sm" variant="outline" aria-label={t.add(u.name)} disabled={add.isPending} onClick={() => onAdd(u)}>
                  {t.add(u.name)}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {error != null && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {errorMessage(error, lang)}
          </p>
        )}
        <section aria-label={t.members}>
          {members.isPending && <p className="text-sm text-muted-foreground">{t.loading}</p>}
          {members.isError && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {errorMessage(members.error, lang)}
            </p>
          )}
          <ul className="divide-y">
            {list.map((m) => (
              <li key={m.userId} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0 truncate text-sm">{m.name}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <Select value={m.role} disabled={readOnly || setRole.isPending} onValueChange={(v) => onRole(m, v as Role)}>
                    <SelectTrigger aria-label={t.roleOf(m.name)} size="sm" className="w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.map((r) => (
                        <SelectItem key={r} value={r}>
                          {t.roles[r]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!readOnly && (
                    <Button size="sm" variant="ghost" aria-label={t.remove(m.name)} disabled={remove.isPending} onClick={() => onRemove(m)}>
                      {t.removeOk}
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
