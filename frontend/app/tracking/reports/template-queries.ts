'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, apiBlob } from '../shared/api/client';
import type { components } from '../shared/api/schema';
import { errorMessage } from '../shared/errors';
import { useLang, useT } from '../shared/i18n';
import { MAX_BYTES } from './queries';

type S = components['schemas'];
export type Template = S['ReportTemplate'];
export type TemplatePatch = S['ReportTemplatePatch'];

// The pre-2007 Office formats (.doc, .xls, .ppt) are accepted too: departments still keep forms in them.
export const TEMPLATE_EXTS = ['.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt', '.pdf'] as const;
export type TemplateKind = 'docx' | 'xlsx' | 'pptx' | 'pdf';

export const tk = ['report-templates'] as const;

const sortTemplates = (ts: Template[]) =>
  [...ts].sort(
    (a, b) =>
      a.category.toLocaleLowerCase().localeCompare(b.category.toLocaleLowerCase()) ||
      a.name.toLocaleLowerCase().localeCompare(b.name.toLocaleLowerCase()) ||
      a.id - b.id,
  );

export const useTemplates = () => useQuery({ queryKey: tk, queryFn: () => api<Template[]>('/report-templates') });

const FAMILY: Record<string, TemplateKind> = { docx: 'docx', doc: 'docx', xlsx: 'xlsx', xls: 'xlsx', pptx: 'pptx', ppt: 'pptx' };

/** The app family (icon and colour); .doc shares Word's with .docx. */
export function kindOf(t: Pick<Template, 'filename'>): TemplateKind {
  return FAMILY[t.filename.toLowerCase().split('.').pop() ?? ''] ?? 'pdf';
}

/** The badge text: the file's own extension (DOC vs DOCX), PDF for anything unexpected. */
export function extLabel(t: Pick<Template, 'filename'>): string {
  const ext = t.filename.toLowerCase().split('.').pop() ?? '';
  return TEMPLATE_EXTS.includes(`.${ext}` as (typeof TEMPLATE_EXTS)[number]) ? ext.toUpperCase() : 'PDF';
}

/** Quick client check; the server repeats it (422 fields.file). */
export function checkTemplateFile(f: File): 'unsupported_type' | 'too_large' | null {
  const name = f.name.toLowerCase();
  if (!TEMPLATE_EXTS.some((e) => name.endsWith(e))) return 'unsupported_type';
  return f.size > MAX_BYTES ? 'too_large' : null;
}

export type NewTemplate = { file: File; category: string; name: string; description: string };

export function useUploadTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, category, name, description }: NewTemplate) => {
      // The server streams the body and reads the text fields only before the file: append them first.
      const body = new FormData();
      body.append('category', category);
      body.append('name', name);
      body.append('description', description);
      body.append('file', file);
      return api<Template>('/report-templates', { method: 'POST', body });
    },
    onSuccess: (t) => qc.setQueryData<Template[]>(tk, (old) => sortTemplates([...(old ?? []), t])),
  });
}

export function useUpdateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: TemplatePatch }) =>
      api<Template>(`/report-templates/${id}`, { method: 'PATCH', json: patch satisfies TemplatePatch }),
    onSuccess: (t) => qc.setQueryData<Template[]>(tk, (old) => sortTemplates((old ?? []).map((x) => (x.id === t.id ? t : x)))),
  });
}

const TEXT = {
  th: { deleted: (n: string) => `ลบแม่แบบ "${n}" แล้ว`, undo: 'เลิกทำ' },
  en: { deleted: (n: string) => `Template "${n}" deleted`, undo: 'Undo' },
};

export function useDeleteTemplate() {
  const qc = useQueryClient();
  const { lang } = useLang();
  const t = useT(TEXT);
  const restore = useMutation({
    mutationFn: (id: number) => api<Template>(`/report-templates/${id}/restore`, { method: 'POST' }),
    onSuccess: (r) => qc.setQueryData<Template[]>(tk, (old) => sortTemplates([...(old ?? []).filter((x) => x.id !== r.id), r])),
    onError: (e) => toast.error(errorMessage(e, lang)),
  });
  return useMutation({
    mutationFn: (tpl: Template) => api<unknown>(`/report-templates/${tpl.id}`, { method: 'DELETE' }),
    onSuccess: (_, tpl) => {
      qc.setQueryData<Template[]>(tk, (old) => old?.filter((x) => x.id !== tpl.id));
      toast(t.deleted(tpl.name), { id: `tpl-${tpl.id}`, action: { label: t.undo, onClick: () => restore.mutate(tpl.id) } });
    },
    onError: (e) => toast.error(errorMessage(e, lang)),
  });
}

/**
 * Local dev auth is a header an <a download> cannot send, so the file is fetched as a blob and saved from an object
 * URL (the same path works behind the gateway's cookie too).
 */
export async function downloadTemplate(tpl: Template) {
  const blob = await apiBlob(`/report-templates/${tpl.id}/file`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = tpl.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the save before the URL goes away.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
