'use client';
import { Archive } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { boardAccess } from '../shared/access';
import { useBoard } from '../shared/api/queries';
import { errorMessage } from '../shared/errors';
import { useLang, useT } from '../shared/i18n';
import { useArchiveProject } from '../projects/project-mutations';

const TEXT = {
  th: {
    archived: 'โปรเจกต์นี้ถูกเก็บถาวรแล้ว ดูได้อย่างเดียวจนกว่า PM จะกู้คืน',
    restore: 'กู้คืนโปรเจกต์',
    restored: 'กู้คืนโปรเจกต์แล้ว',
  },
  en: {
    archived: 'This project is archived. It is read-only until a PM restores it.',
    restore: 'Restore project',
    restored: 'Project restored',
  },
};

/** Shown above an archived project's board; PM and admin get the Restore action here. */
export function ArchivedBanner({ projectId }: { projectId: number }) {
  const t = useT(TEXT);
  const { lang } = useLang();
  const access = boardAccess(useBoard(projectId).data);
  const restore = useArchiveProject(projectId);
  if (!access.archived) return null;

  async function onRestore() {
    try {
      await restore.mutateAsync(true);
      toast.success(t.restored);
    } catch (e) {
      toast.error(errorMessage(e, lang));
    }
  }

  return (
    <div role="status" className="mx-4 mb-3 flex flex-wrap items-center gap-3 rounded-lg border bg-muted/50 px-4 py-2.5 text-sm">
      <Archive className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1">{t.archived}</span>
      {access.canRestore && (
        <Button variant="outline" size="sm" disabled={restore.isPending} onClick={() => void onRestore()}>
          {t.restore}
        </Button>
      )}
    </div>
  );
}
