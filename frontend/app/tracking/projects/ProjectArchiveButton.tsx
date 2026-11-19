'use client';
import { Archive, ArchiveRestore } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useConfirm } from '../shared/confirm';
import { errorMessage } from '../shared/errors';
import { useLang, useT } from '../shared/i18n';
import { useArchiveProject } from './project-mutations';
import type { ProjectRow } from './project-row';

const TEXT = {
  th: {
    archive: (n: string) => `เก็บถาวร ${n}`,
    restore: (n: string) => `กู้คืน ${n}`,
    confirmTitle: (n: string) => `เก็บ "${n}" ถาวร?`,
    confirmBody: 'โปรเจกต์จะย้ายไปที่ "โปรเจกต์ที่เก็บถาวร" และแก้ไขไม่ได้จนกว่าจะกู้คืน',
    confirm: 'เก็บถาวร',
    archived: (n: string) => `เก็บ "${n}" ถาวรแล้ว`,
    restored: (n: string) => `กู้คืน "${n}" แล้ว`,
    undo: 'เลิกทำ',
  },
  en: {
    archive: (n: string) => `Archive ${n}`,
    restore: (n: string) => `Restore ${n}`,
    confirmTitle: (n: string) => `Archive "${n}"?`,
    confirmBody: 'The project moves to "Archived projects" and is read-only until it is restored.',
    confirm: 'Archive',
    archived: (n: string) => `"${n}" archived`,
    restored: (n: string) => `"${n}" restored`,
    undo: 'Undo',
  },
};

/**
 * Archive (live project) or Restore (archived project) from the projects list. Only admin and PM see it; the server
 * enforces the same rule. Archive asks first and offers Undo; Restore needs no confirmation.
 */
export function ProjectArchiveButton({ project }: { project: ProjectRow }) {
  const t = useT(TEXT);
  const { lang } = useLang();
  const confirm = useConfirm();
  const mutation = useArchiveProject(project.id);
  if (project.myRole !== 'admin' && project.myRole !== 'pm') return null;
  const archived = !!project.archivedAt;

  const run = async (restore: boolean) => {
    try {
      await mutation.mutateAsync(restore);
      if (restore) toast.success(t.restored(project.name), { id: `project-${project.id}` });
      else
        toast.success(t.archived(project.name), {
          id: `project-${project.id}`,
          action: { label: t.undo, onClick: () => void run(true) },
        });
    } catch (e) {
      toast.error(errorMessage(e, lang), { id: `project-${project.id}` });
    }
  };
  const onClick = async () => {
    if (archived) return run(true);
    const ok = await confirm({
      title: t.confirmTitle(project.name),
      description: t.confirmBody,
      confirmLabel: t.confirm,
      destructive: true,
      typeToConfirm: project.name,
    });
    if (ok) await run(false);
  };

  const label = archived ? t.restore(project.name) : t.archive(project.name);
  const Icon = archived ? ArchiveRestore : Archive;
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      disabled={mutation.isPending}
      onClick={() => void onClick()}
    >
      <Icon aria-hidden />
    </Button>
  );
}
