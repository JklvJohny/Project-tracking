'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { api, ApiError } from '../shared/api/client';
import { qk } from '../shared/api/queries';
import type { components } from '../shared/api/schema';
import { errorMessage, errorText } from '../shared/errors';
import { useLang, useT } from '../shared/i18n';
import { routes } from '../shared/routes';

type S = components['schemas'];
const FIELDS = ['name', 'description', 'startDate', 'endDate'] as const;
type Field = (typeof FIELDS)[number];

const TEXT = {
  th: {
    title: 'โปรเจกต์ใหม่',
    desc: 'สร้างบอร์ดพร้อมลิสต์เริ่มต้นสี่ลิสต์',
    name: 'ชื่อโปรเจกต์',
    description: 'รายละเอียด',
    startDate: 'วันเริ่มต้น',
    endDate: 'วันสิ้นสุด',
    cancel: 'ยกเลิก',
    submit: 'สร้างโปรเจกต์',
    submitting: 'กำลังสร้าง…',
  },
  en: {
    title: 'New project',
    desc: 'Creates a board with four default lists.',
    name: 'Project name',
    description: 'Description',
    startDate: 'Start date',
    endDate: 'End date',
    cancel: 'Cancel',
    submit: 'Create project',
    submitting: 'Creating…',
  },
};

/** Adds the project to the cached list, then redirects: a post-submit redirect, not click navigation. */
export function useCreateProject() {
  const qc = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: (input: S['CreateProjectInput']) => api<S['Project']>('/projects', { method: 'POST', json: input }),
    onSuccess: (p) => {
      qc.setQueryData<S['Project'][]>(qk.projects, (old) => [...(old ?? []), p]);
      router.replace(routes.board(p.id));
    },
  });
}

export function CreateProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  // The form is a child of DialogContent, which unmounts on close, so errors and input reset on reopen.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <CreateProjectForm onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}

function CreateProjectForm({ onOpenChange }: { onOpenChange: (o: boolean) => void }) {
  const t = useT(TEXT);
  const { lang } = useLang();
  const create = useCreateProject();
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Focus after the error markup is committed so aria-invalid is already set.
  useEffect(() => {
    const first = FIELDS.find((f) => errors[f]);
    if (first) (formRef.current?.elements.namedItem(first) as HTMLElement | null)?.focus();
  }, [errors]);

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
    create.mutate(
      {
        name: val('name'),
        description: val('description'),
        startDate: val('startDate') || null,
        endDate: val('endDate') || null,
        lang,
      },
      {
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

  const field = (f: Field) => ({
    id: `cp-${f}`,
    name: f,
    'aria-invalid': errors[f] ? (true as const) : undefined,
    'aria-describedby': errors[f] ? `cp-${f}-err` : undefined,
  });
  const err = (f: Field) =>
    errors[f] ? (
      <p id={`cp-${f}-err`} role="alert" className="mt-1 text-xs font-medium text-destructive">
        {errorText(errors[f]!, lang)}
      </p>
    ) : null;

  return (
    <>
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.desc}</DialogDescription>
        </DialogHeader>
        <form ref={formRef} noValidate onSubmit={onSubmit} className="space-y-4">
          <div>
            <label htmlFor="cp-name" className="mb-1.5 block text-sm font-medium">
              {t.name} <span aria-hidden="true" className="text-destructive">*</span>
            </label>
            <Input {...field('name')} maxLength={200} />
            {err('name')}
          </div>
          <div>
            <label htmlFor="cp-description" className="mb-1.5 block text-sm font-medium">{t.description}</label>
            <Textarea {...field('description')} rows={3} />
            {err('description')}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="cp-startDate" className="mb-1.5 block text-sm font-medium">{t.startDate}</label>
              <Input {...field('startDate')} type="date" />
              {err('startDate')}
            </div>
            <div>
              <label htmlFor="cp-endDate" className="mb-1.5 block text-sm font-medium">{t.endDate}</label>
              <Input {...field('endDate')} type="date" />
              {err('endDate')}
            </div>
          </div>
          {formError && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {formError}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t.cancel}
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? t.submitting : t.submit}
            </Button>
          </DialogFooter>
        </form>
    </>
  );
}
