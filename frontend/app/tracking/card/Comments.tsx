'use client';
import { Pencil, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { boardAccess } from '../shared/access';
import { useBoard, useComments, useMe } from '../shared/api/queries';
import type { components } from '../shared/api/schema';
import { useConfirm } from '../shared/confirm';
import { errorMessage } from '../shared/errors';
import { fmtDate } from '../shared/format';
import { useLang, useT } from '../shared/i18n';
import { CommentEditor } from './CommentEditor';
import { SaveStatus, useInlineSave } from './inline';
import { useAddComment, useDeleteComment, useEditComment } from './mutations';
import { Rendered } from './Rendered';

type Comment = components['schemas']['Comment'];

const TEXT = {
  th: {
    title: 'ความคิดเห็น',
    empty: 'ยังไม่มีความคิดเห็น',
    send: 'ส่งความคิดเห็น',
    save: 'บันทึก',
    edited: 'แก้ไขแล้ว',
    edit: (n: string) => `แก้ไขความคิดเห็นของ ${n}`,
    del: (n: string) => `ลบความคิดเห็นของ ${n}`,
    confirmTitle: 'ลบความคิดเห็นนี้?',
    confirmBody: 'ลบแล้วจะกู้คืนไม่ได้',
    confirmOk: 'ลบ',
    loading: 'กำลังโหลดความคิดเห็น',
    retry: 'ลองอีกครั้ง',
    unknown: 'ผู้ใช้ที่ไม่รู้จัก',
  },
  en: {
    title: 'Comments',
    empty: 'No comments yet',
    send: 'Send comment',
    save: 'Save',
    edited: 'edited',
    edit: (n: string) => `Edit comment by ${n}`,
    del: (n: string) => `Delete comment by ${n}`,
    confirmTitle: 'Delete this comment?',
    confirmBody: 'This cannot be undone.',
    confirmOk: 'Delete',
    loading: 'Loading comments',
    retry: 'Retry',
    unknown: 'Unknown user',
  },
};

export function Comments({ projectId, cardId, readOnly = false }: { projectId: number; cardId: number; readOnly?: boolean }) {
  const t = useT(TEXT);
  const { lang } = useLang();
  const confirm = useConfirm();
  const board = useBoard(projectId).data;
  const me = useMe().data?.user.id;
  const comments = useComments(cardId);
  const add = useAddComment(projectId, cardId);
  const edit = useEditComment(cardId);
  const del = useDeleteComment(projectId, cardId);
  const { state, save } = useInlineSave<number>(del.mutateAsync);
  const [editing, setEditing] = useState<number | null>(null);

  const users = useMemo(() => new Map((board?.users ?? []).map((u) => [u.id, { name: u.name }])), [board?.users]);
  // Mentions are for project members only; names come from the users profile list.
  const mentionable = useMemo(
    () => (board?.members ?? []).map((m) => ({ id: m.userId, name: users.get(m.userId)?.name ?? m.name })),
    [board?.members, users],
  );
  const access = boardAccess(board);
  const canWrite = !readOnly && access.canEdit;
  const canModerate = access.canManage;
  const list = comments.data ?? [];

  async function remove(c: Comment) {
    const ok = await confirm({ title: t.confirmTitle, description: t.confirmBody, confirmLabel: t.confirmOk, destructive: true });
    if (ok) void save(c.id);
  }

  return (
    <section aria-label={t.title} className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold">
        {t.title} <span className="font-normal text-muted-foreground tabular-nums">{list.length}</span>
      </h3>
      {comments.isError ? (
        <div role="alert" className="flex items-center gap-3 text-sm">
          <span>{errorMessage(comments.error, lang)}</span>
          <Button variant="outline" size="sm" onClick={() => comments.refetch()}>
            {t.retry}
          </Button>
        </div>
      ) : comments.isPending ? (
        <Skeleton role="status" aria-label={t.loading} className="h-12 w-full" />
      ) : list.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.empty}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.map((c) => {
            const name = users.get(c.authorId)?.name ?? t.unknown;
            const mine = me === c.authorId;
            return (
              <li key={c.id} data-comment={c.id} className="flex flex-col gap-1 rounded-lg border p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{name}</span>
                  <time dateTime={c.createdAt}>{fmtDate(c.createdAt, lang)}</time>
                  {c.editedAt && <span>({t.edited})</span>}
                  <span className="ml-auto" />
                  {canWrite && mine && editing !== c.id && (
                    <Button variant="ghost" size="icon-xs" aria-label={t.edit(name)} title={t.edit(name)} onClick={() => setEditing(c.id)}>
                      <Pencil aria-hidden />
                    </Button>
                  )}
                  {canWrite && (mine || canModerate) && (
                    <Button variant="ghost" size="icon-xs" aria-label={t.del(name)} title={t.del(name)} onClick={() => void remove(c)}>
                      <Trash2 aria-hidden />
                    </Button>
                  )}
                </div>
                {editing === c.id ? (
                  <CommentEditor
                    autoFocus
                    members={mentionable}
                    initial={c.bodyMd}
                    submitLabel={t.save}
                    onCancel={() => setEditing(null)}
                    onSubmit={async (bodyMd) => {
                      if (bodyMd !== c.bodyMd) await edit.mutateAsync({ id: c.id, bodyMd });
                      setEditing(null);
                    }}
                  />
                ) : (
                  <Rendered source={c.bodyMd} users={users} />
                )}
              </li>
            );
          })}
        </ul>
      )}
      <SaveStatus state={state.kind === 'error' ? state : { kind: 'idle' }} />
      {canWrite && <CommentEditor members={mentionable} submitLabel={t.send} onSubmit={(body) => add.mutateAsync(body)} />}
    </section>
  );
}
