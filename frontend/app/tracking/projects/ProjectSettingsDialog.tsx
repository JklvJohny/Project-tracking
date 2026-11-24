'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { DateInput } from '../shared/DateInput';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
    restore: 'กู้คืนโปรเจกต์',
    archivedDesc: 'โปรเจกต์นี้ถูกเก็บถาวร กู้คืนก่อนจึงจะแก้ไขได้',
    close: 'ปิด',
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
    restore: 'Restore project',
    archivedDesc: 'This project is archived. Restore it to edit it.',
    close: 'Close',
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
  // The error itself, not its text: the message is resolved at render so it follows a language switch.
  const [formError, setFormError] = useState<unknown>(null);
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
      // An empty date input clears the date: null, as for cards.
      {
        name: val('name'),
        description: val('description'),
        startDate: val('startDate') || null,
        endDate: val('endDate') || null,
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
          else setFormError(err);
        },
      },
    );
  }

  async function onArchive() {
    setFormError(null);
    const ok = await confirm({
      title: t.archiveTitle,
      description: t.archiveDesc,
      confirmLabel: t.archive,
      destructive: true,
      typeToConfirm: project?.name,
    });
    if (!ok) return;
    try {
      await archive.mutateAsync(false);
    } catch (e) {
      setFormError(e);
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

  // An archived project is read-only (the server answers project_archived); Restore is the one action left.
  const archived = !!project.archivedAt;

  async function onRestore() {
    setFormError(null);
    try {
      await archive.mutateAsync(true);
    } catch (e) {
      setFormError(e);
      return;
    }
    toast.success(t.restored);
    onOpenChange(false);
  }

  const field = (f: Field) => ({
    id: `ps-${f}`,
    name: f,
    disabled: archived,
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
        <DialogDescription>{archived ? t.archivedDesc : t.desc}</DialogDescription>
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
            <DateInput {...field('startDate')} defaultValue={project.startDate ?? ''} />
            {err('startDate')}
          </div>
          <div>
            <label htmlFor="ps-endDate" className={label}>{t.endDate}</label>
            <DateInput {...field('endDate')} defaultValue={project.endDate ?? ''} />
            {err('endDate')}
          </div>
        </div>
        <div>
          <label htmlFor="ps-status" className={label}>{t.status}</label>
          {/* Radix renders a hidden native select from `name`, so the status still reaches the form's FormData. */}
          <Select name="status" defaultValue={project.status} disabled={archived}>
            <SelectTrigger
              id="ps-status"
              className="w-full"
              aria-invalid={errors.status ? true : undefined}
              aria-describedby={errors.status ? 'ps-status-err' : undefined}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {t.statuses[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {err('status')}
        </div>
        {formError != null && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {errorMessage(formError, lang)}
          </p>
        )}
        {archived ? (
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t.close}
            </Button>
            <Button type="button" disabled={archive.isPending} onClick={() => void onRestore()}>
              {t.restore}
            </Button>
          </DialogFooter>
        ) : (
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
        )}
      </form>
    </>
  );
}
