'use client';
import { FileUp } from 'lucide-react';
import { useId, useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '../shared/api/client';
import { errorMessage, errorText } from '../shared/errors';
import { useLang, useT } from '../shared/i18n';
import { fmtSize } from './DocumentTable';
import { TEMPLATE_EXTS, checkTemplateFile, useUpdateTemplate, useUploadTemplate, type Template } from './template-queries';

const TEXT = {
  th: {
    newTitle: 'อัปโหลดแม่แบบรายงาน',
    editTitle: 'แก้ไขแม่แบบรายงาน',
    file: 'ไฟล์',
    choose: 'เลือกไฟล์',
    fileHint: 'Word, Excel, PowerPoint หรือ PDF ไม่เกิน 20 MB',
    category: 'ประเภทรายงาน',
    categoryHint: 'เช่น รายงานประจำสัปดาห์',
    name: 'ชื่อแม่แบบ',
    description: 'คำอธิบาย',
    optional: '(ไม่บังคับ)',
    cancel: 'ยกเลิก',
    upload: 'อัปโหลด',
    uploading: 'กำลังอัปโหลด…',
    save: 'บันทึก',
    saving: 'กำลังบันทึก…',
    uploaded: (n: string) => `อัปโหลด "${n}" แล้ว`,
    saved: 'บันทึกแล้ว',
  },
  en: {
    newTitle: 'Upload a report template',
    editTitle: 'Edit report template',
    file: 'File',
    choose: 'Choose a file',
    fileHint: 'Word, Excel, PowerPoint or PDF, up to 20 MB',
    category: 'Report type',
    categoryHint: 'e.g. Weekly report',
    name: 'Template name',
    description: 'Description',
    optional: '(optional)',
    cancel: 'Cancel',
    upload: 'Upload',
    uploading: 'Uploading…',
    save: 'Save',
    saving: 'Saving…',
    uploaded: (n: string) => `"${n}" uploaded`,
    saved: 'Saved',
  },
};

type Field = 'file' | 'category' | 'name' | 'description';
const LIMITS = { category: 60, name: 120, description: 500 } as const;

const baseName = (f: string) => f.replace(/\.[^.]+$/, '');

/** Upload a new template (no `template`) or edit one's details. Categories already in use are suggested. */
export function TemplateDialog({
  template,
  categories,
  defaultCategory = '',
  onClose,
}: {
  template?: Template;
  categories: string[];
  defaultCategory?: string;
  onClose: () => void;
}) {
  const t = useT(TEXT);
  const { lang } = useLang();
  const ids = useId();
  const upload = useUploadTemplate();
  const update = useUpdateTemplate();
  const editing = !!template;
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState(template?.category ?? defaultCategory);
  const [name, setName] = useState(template?.name ?? '');
  const [description, setDescription] = useState(template?.description ?? '');
  // Once typed, the name is the user's; until then it follows the chosen file.
  const nameTouched = useRef(editing);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<unknown>(null);
  const fileRef = useRef<HTMLButtonElement>(null);
  const categoryRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const busy = upload.isPending || update.isPending;

  const pick = (f: File | undefined) => {
    if (!f) return;
    const bad = checkTemplateFile(f);
    setErrors((e) => ({ ...e, file: bad ?? undefined }));
    setFile(f);
    if (!nameTouched.current) setName(baseName(f.name));
  };

  function validate(): Partial<Record<Field, string>> {
    const e: Partial<Record<Field, string>> = {};
    if (!editing) {
      if (!file) e.file = 'required';
      else {
        const bad = checkTemplateFile(file);
        if (bad) e.file = bad;
      }
    }
    if (!category.trim()) e.category = 'required';
    else if ([...category.trim()].length > LIMITS.category) e.category = 'too_long';
    if (!name.trim()) e.name = 'required';
    else if ([...name.trim()].length > LIMITS.name) e.name = 'too_long';
    if ([...description.trim()].length > LIMITS.description) e.description = 'too_long';
    return e;
  }

  function showErrors(e: Partial<Record<Field, string>>) {
    setErrors(e);
    const first = (['file', 'category', 'name', 'description'] as Field[]).find((f) => e[f]);
    const el = { file: fileRef, category: categoryRef, name: nameRef, description: descriptionRef }[first ?? 'file'];
    if (first) el.current?.focus();
  }

  function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    setFormError(null);
    const e = validate();
    if (Object.keys(e).length) return showErrors(e);
    const onError = (err: unknown) => {
      const fields = err instanceof ApiError ? err.fields : undefined;
      if (fields && Object.keys(fields).length) showErrors(fields as Partial<Record<Field, string>>);
      else setFormError(err);
    };
    const details = { category: category.trim(), name: name.trim(), description: description.trim() };
    if (template)
      update.mutate(
        { id: template.id, patch: details },
        {
          onSuccess: () => {
            toast.success(t.saved, { id: `tpl-${template.id}` });
            onClose();
          },
          onError,
        },
      );
    else
      upload.mutate(
        { file: file!, ...details },
        {
          onSuccess: (r) => {
            toast.success(t.uploaded(r.name), { id: `tpl-${r.id}` });
            onClose();
          },
          onError,
        },
      );
  }

  const label = 'mb-1.5 block text-sm font-medium';
  const err = (f: Field) =>
    errors[f] ? (
      <p id={`${ids}-${f}-err`} role="alert" className="mt-1 text-sm text-destructive">
        {errorText(errors[f]!, lang)}
      </p>
    ) : null;
  const aria = (f: Field) => ({
    'aria-invalid': errors[f] ? (true as const) : undefined,
    'aria-describedby': errors[f] ? `${ids}-${f}-err` : undefined,
  });

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent aria-describedby={undefined} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? t.editTitle : t.newTitle}</DialogTitle>
        </DialogHeader>
        <form noValidate onSubmit={onSubmit} className="space-y-4">
          {!editing && (
            <div>
              <span id={`${ids}-file`} className={label}>
                {t.file}
              </span>
              <input
                ref={fileInput}
                type="file"
                hidden
                accept={TEMPLATE_EXTS.join(',')}
                onChange={(e) => pick(e.target.files?.[0])}
              />
              <button
                ref={fileRef}
                type="button"
                aria-labelledby={`${ids}-file ${ids}-file-name`}
                {...aria('file')}
                onClick={() => fileInput.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  pick(e.dataTransfer.files[0]);
                }}
                className={`flex w-full items-center gap-3 rounded-lg border border-dashed px-4 py-4 text-left hover:bg-accent/50 ${
                  errors.file ? 'border-destructive' : ''
                }`}
              >
                <FileUp className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                <span id={`${ids}-file-name`} className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{file ? file.name : t.choose}</span>
                  <span className="block text-xs text-muted-foreground">{file ? fmtSize(file.size) : t.fileHint}</span>
                </span>
              </button>
              {err('file')}
            </div>
          )}
          <div>
            <label htmlFor={`${ids}-category`} className={label}>
              {t.category}
            </label>
            <Input
              ref={categoryRef}
              id={`${ids}-category`}
              list={`${ids}-categories`}
              value={category}
              placeholder={t.categoryHint}
              maxLength={LIMITS.category}
              onChange={(e) => setCategory(e.target.value)}
              {...aria('category')}
            />
            <datalist id={`${ids}-categories`}>
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            {err('category')}
          </div>
          <div>
            <label htmlFor={`${ids}-name`} className={label}>
              {t.name}
            </label>
            <Input
              ref={nameRef}
              id={`${ids}-name`}
              value={name}
              maxLength={LIMITS.name}
              onChange={(e) => {
                nameTouched.current = true;
                setName(e.target.value);
              }}
              {...aria('name')}
            />
            {err('name')}
          </div>
          <div>
            <label htmlFor={`${ids}-description`} className={label}>
              {t.description} <span className="font-normal text-muted-foreground">{t.optional}</span>
            </label>
            <Textarea
              ref={descriptionRef}
              id={`${ids}-description`}
              value={description}
              rows={3}
              maxLength={LIMITS.description}
              onChange={(e) => setDescription(e.target.value)}
              {...aria('description')}
            />
            {err('description')}
          </div>
          {formError != null && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {errorMessage(formError, lang)}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              {t.cancel}
            </Button>
            <Button type="submit" disabled={busy}>
              {editing ? (busy ? t.saving : t.save) : busy ? t.uploading : t.upload}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
