'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '../shared/api/client';
import { useBoard } from '../shared/api/queries';
import type { components } from '../shared/api/schema';
import { useConfirm } from '../shared/confirm';
import { errorMessage, errorText } from '../shared/errors';
import { useLang, useT } from '../shared/i18n';
import { routes } from '../shared/routes';
import { useArchiveProject, useUpdateProject } from './project-mutations';

type Status = components['schemas']['ProjectStatus'];
const STATUSES: Status[] = ['active', 'on_hold', 'done'];
const FIELDS = ['name', 'description', 'startDate', 'endDate', 'status'] as const;
type Field = (typeof FIELDS)[number];

const TEXT = {
  th: {
    title: 'ตั้งค่าโปรเจกต์',
    desc: 'แก้ไขข้อมูลโปรเจกต์ หรือเก็บโปรเจกต์ถาวร',
    name: 'ชื่อโปรเจกต์',
    description: 'รายละเอียด',
    startDate: 'วันเริ่มต้น',
    endDate: 'วันสิ้นสุด',
    status: 'สถานะ',
    statuses: { active: 'กำลังดำเนินการ', on_hold: 'พักไว้', done: 'เสร็จสิ้น' } as Record<Status, string>,
    cancel: 'ยกเลิก',
    save: 'บันทึก',
    saving: 'กำลังบันทึก…',
    saved: 'บันทึกแล้ว',
    archive: 'เก็บโปรเจกต์ถาวร',
    archiveTitle: 'เก็บโปรเจกต์นี้ถาวร?',
    archiveDesc: 'โปรเจกต์จะหายจากรายการ กู้คืนได้ภายหลัง',
    archived: 'เก็บโปรเจกต์ถาวรแล้ว',
    undo: 'เลิกทำ',
    restored: 'กู้คืนโปรเจกต์แล้ว',
  },
  en: {
    title: 'Project settings',
    desc: 'Edit the project details, or archive it.',
    name: 'Project name',
    description: 'Description',
    startDate: 'Start date',
    endDate: 'End date',
    status: 'Status',
    statuses: { active: 'Active', on_hold: 'On hold', done: 'Done' } as Record<Status, string>,
    cancel: 'Cancel',
    save: 'Save',
    saving: 'Saving…',
    saved: 'Saved',
    archive: 'Archive project',
    archiveTitle: 'Archive this project?',
    archiveDesc: 'It leaves your project list. You can restore it later.',
    archived: 'Project archived',
    undo: 'Undo',
    restored: 'Project restored',
  },
};

export function ProjectSettingsDialog({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: number;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  // The form unmounts with DialogContent, so errors and edits reset on reopen.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <SettingsForm projectId={projectId} onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}

function SettingsForm({ projectId, onOpenChange }: { projectId: number; onOpenChange: (o: boolean) => void }) {
  const t = useT(TEXT);
  const { lang } = useLang();
  const router = useRouter();
  const confirm = useConfirm();
  const project = useBoard(projectId).data?.project;
  const update = useUpdateProject(projectId);
  const archive = useArchiveProject(projectId);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const first = FIELDS.find((f) => errors[f]);
    if (first) (formRef.current?.elements.namedItem(first) as HTMLElement | null)?.focus();
  }, [errors]);

  if (!project) return null;

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const val = (k: Field) => String(fd.get(k) ?? '').trim();
    if (!val('name')) {
      setErrors({ name: 'required' });
      return;
    }
    setErrors({});
    setFormError(null);
    update.mutate(
      // An empty date string clears the date on the server.
      {
        name: val('name'),
        description: val('description'),
        startDate: val('startDate'),
        endDate: val('endDate'),
        status: val('status') as Status,
      },
      {
        onSuccess: () => {
          toast.success(t.saved);
          onOpenChange(false);
        },
        onError: (err) => {
          const fields = err instanceof ApiError ? err.fields : undefined;
          const next: Partial<Record<Field, string>> = {};
          for (const f of FIELDS) if (fields?.[f]) next[f] = fields[f];
          if (Object.keys(next).length) setErrors(next);
          else setFormError(errorMessage(err, lang));
        },
      },
    );
  }

  async function onArchive() {
    setFormError(null);
    const ok = await confirm({ title: t.archiveTitle, description: t.archiveDesc, confirmLabel: t.archive, destructive: true });
    if (!ok) return;
    try {
      await archive.mutateAsync(false);
    } catch (e) {
      setFormError(errorMessage(e, lang));
      return;
    }
    onOpenChange(false);
    router.replace(routes.projects);
    // This form is unmounted when Undo is clicked, so per-call mutate callbacks would not run; await instead.
    toast(t.archived, {
      action: {
        label: t.undo,
        onClick: async () => {
          try {
            await archive.mutateAsync(true);
            toast.success(t.restored);
          } catch (e) {
            toast.error(errorMessage(e, lang));
          }
        },
      },
    });
  }

  const field = (f: Field) => ({
    id: `ps-${f}`,
    name: f,
    'aria-invalid': errors[f] ? (true as const) : undefined,
    'aria-describedby': errors[f] ? `ps-${f}-err` : undefined,
  });
  const err = (f: Field) =>
    errors[f] ? (
      <p id={`ps-${f}-err`} role="alert" className="mt-1 text-xs font-medium text-destructive">
        {errorText(errors[f]!, lang)}
      </p>
    ) : null;
  const label = 'mb-1.5 block text-sm font-medium';

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t.title}</DialogTitle>
        <DialogDescription>{t.desc}</DialogDescription>
      </DialogHeader>
      <form ref={formRef} noValidate onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="ps-name" className={label}>
            {t.name} <span aria-hidden="true" className="text-destructive">*</span>
          </label>
          <Input {...field('name')} defaultValue={project.name} maxLength={200} />
          {err('name')}
        </div>
        <div>
          <label htmlFor="ps-description" className={label}>{t.description}</label>
          <Textarea {...field('description')} defaultValue={project.description} rows={3} />
          {err('description')}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="ps-startDate" className={label}>{t.startDate}</label>
            <Input {...field('startDate')} type="date" defaultValue={project.startDate ?? ''} />
            {err('startDate')}
          </div>
          <div>
            <label htmlFor="ps-endDate" className={label}>{t.endDate}</label>
            <Input {...field('endDate')} type="date" defaultValue={project.endDate ?? ''} />
            {err('endDate')}
          </div>
        </div>
        <div>
          <label htmlFor="ps-status" className={label}>{t.status}</label>
          <select
            {...field('status')}
            defaultValue={project.status}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t.statuses[s]}
              </option>
            ))}
          </select>
          {err('status')}
        </div>
        {formError && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {formError}
          </p>
        )}
        <DialogFooter className="sm:justify-between">
          <Button type="button" variant="outline" className="text-destructive" disabled={archive.isPending} onClick={onArchive}>
            {t.archive}
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t.cancel}
            </Button>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? t.saving : t.save}
            </Button>
          </div>
        </DialogFooter>
      </form>
    </>
  );
}
