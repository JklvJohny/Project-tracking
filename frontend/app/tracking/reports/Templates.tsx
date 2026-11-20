'use client';
import { Download, FileSpreadsheet, FileText, LayoutTemplate, Pencil, Plus, Presentation, Search, Trash2, type LucideIcon } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '../shared/errors';
import { fmtDate } from '../shared/format';
import { useLang, useT } from '../shared/i18n';
import { fmtSize } from './DocumentTable';
import { TemplateDialog } from './TemplateDialog';
import { downloadTemplate, kindOf, useDeleteTemplate, useTemplates, type Template, type TemplateKind } from './template-queries';

const TEXT = {
  th: {
    count: (n: number) => `${n} แม่แบบ`,
    upload: 'อัปโหลดแม่แบบ',
    search: 'ค้นหาแม่แบบ',
    caption: 'แม่แบบรายงานแยกตามประเภท',
    name: 'แม่แบบ',
    type: 'ชนิดไฟล์',
    size: 'ขนาด',
    by: 'อัปโหลดโดย',
    updated: 'อัปเดต',
    actions: 'การทำงาน',
    download: (n: string) => `ดาวน์โหลด ${n}`,
    edit: (n: string) => `แก้ไข ${n}`,
    del: (n: string) => `ลบ ${n}`,
    addTo: (c: string) => `เพิ่มแม่แบบใน ${c}`,
    unknown: 'ไม่ทราบชื่อ',
    empty: 'ยังไม่มีแม่แบบรายงาน',
    emptyHint: 'อัปโหลดไฟล์ Word, Excel, PowerPoint หรือ PDF ที่ทีมใช้เป็นแม่แบบ แล้วจัดกลุ่มตามประเภทรายงาน',
    noMatch: 'ไม่พบแม่แบบที่ตรงกับคำค้นหา',
    retry: 'ลองอีกครั้ง',
    loading: 'กำลังโหลดแม่แบบ',
  },
  en: {
    count: (n: number) => `${n} template${n === 1 ? '' : 's'}`,
    upload: 'Upload template',
    search: 'Search templates',
    caption: 'Report templates by type',
    name: 'Template',
    type: 'File type',
    size: 'Size',
    by: 'Uploaded by',
    updated: 'Updated',
    actions: 'Actions',
    download: (n: string) => `Download ${n}`,
    edit: (n: string) => `Edit ${n}`,
    del: (n: string) => `Delete ${n}`,
    addTo: (c: string) => `Add a template to ${c}`,
    unknown: 'Unknown',
    empty: 'No report templates yet',
    emptyHint: 'Upload the Word, Excel, PowerPoint or PDF files your team fills in, grouped by report type.',
    noMatch: 'No templates match your search',
    retry: 'Retry',
    loading: 'Loading templates',
  },
};

// The file type is spelled out next to the icon, so colour is never the only cue.
const KIND: Record<TemplateKind, { icon: LucideIcon; label: string; cls: string }> = {
  docx: { icon: FileText, label: 'DOCX', cls: 'bg-sky-100 text-sky-800 dark:bg-sky-400/15 dark:text-sky-200' },
  xlsx: { icon: FileSpreadsheet, label: 'XLSX', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-200' },
  pptx: { icon: Presentation, label: 'PPTX', cls: 'bg-orange-100 text-orange-800 dark:bg-orange-400/15 dark:text-orange-200' },
  pdf: { icon: FileText, label: 'PDF', cls: 'bg-red-100 text-red-800 dark:bg-red-400/15 dark:text-red-200' },
};

const TH = 'px-3 py-2 font-medium whitespace-nowrap';
const TD = 'px-3 py-2.5 align-middle';

/** Reports › Templates: department-wide report templates, grouped by their free-text category. */
export function Templates() {
  const t = useT(TEXT);
  const { lang } = useLang();
  const q = useTemplates();
  const del = useDeleteTemplate();
  const [search, setSearch] = useState('');
  // null = closed; { } = new; { template } = edit; { category } = new, prefilled from a group's "+".
  const [dialog, setDialog] = useState<{ template?: Template; category?: string } | null>(null);
  const list = useMemo(() => q.data ?? [], [q.data]);
  const categories = useMemo(() => [...new Set(list.map((x) => x.category))], [list]);

  const needle = search.trim().toLocaleLowerCase();
  const shown = needle
    ? list.filter((x) => [x.name, x.category, x.description, x.filename].some((s) => s.toLocaleLowerCase().includes(needle)))
    : list;
  const groups = new Map<string, Template[]>();
  for (const x of shown) groups.set(x.category, [...(groups.get(x.category) ?? []), x]);

  const download = (x: Template) => downloadTemplate(x).catch((e) => toast.error(errorMessage(e, lang), { id: `tpl-dl-${x.id}` }));

  let body;
  if (q.isPending)
    body = (
      <div role="status" aria-label={t.loading} className="space-y-2 p-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    );
  else if (q.isError)
    body = (
      <div role="alert" className="flex flex-col items-start gap-3 p-6">
        <p className="text-sm">{errorMessage(q.error, lang)}</p>
        <Button variant="outline" onClick={() => q.refetch()}>
          {t.retry}
        </Button>
      </div>
    );
  else if (list.length === 0)
    body = (
      <div className="flex flex-col items-center px-6 py-14 text-center">
        <LayoutTemplate className="mb-3 size-8 text-muted-foreground" aria-hidden />
        <p className="font-semibold">{t.empty}</p>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{t.emptyHint}</p>
        <Button className="mt-4" onClick={() => setDialog({})}>
          <Plus aria-hidden />
          {t.upload}
        </Button>
      </div>
    );
  else if (shown.length === 0) body = <p className="px-6 py-10 text-center text-sm text-muted-foreground">{t.noMatch}</p>;
  else
    body = (
      // relative: the sr-only caption is absolutely positioned and must not widen the page from outside the scroller.
      <div className="relative overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{t.caption}</caption>
          <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className={TH}>{t.name}</th>
              <th scope="col" className={TH}>{t.type}</th>
              <th scope="col" className={`${TH} text-right`}>{t.size}</th>
              <th scope="col" className={TH}>{t.by}</th>
              <th scope="col" className={TH}>{t.updated}</th>
              <th scope="col" className={`${TH} w-px`}>
                <span className="sr-only">{t.actions}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {[...groups].map(([category, rows]) => (
              <Fragment key={category}>
                <tr className="border-b bg-muted/30">
                  <th scope="colgroup" colSpan={5} className="px-3 py-1.5 text-left text-xs font-semibold">
                    {category} <span className="font-normal text-muted-foreground tabular-nums">({rows.length})</span>
                  </th>
                  <td className="px-2 py-1 text-right">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t.addTo(category)}
                      title={t.addTo(category)}
                      onClick={() => setDialog({ category })}
                    >
                      <Plus aria-hidden />
                    </Button>
                  </td>
                </tr>
                {rows.map((x) => {
                  const k = KIND[kindOf(x)];
                  return (
                    <tr key={x.id} className="border-b last:border-0 hover:bg-accent/50">
                      <td className={`${TD} max-w-96 min-w-56`}>
                        <div className="flex items-start gap-2.5">
                          <k.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                          <div className="min-w-0">
                            <button
                              type="button"
                              onClick={() => void download(x)}
                              className="text-left font-medium break-words hover:underline"
                              title={t.download(x.filename)}
                            >
                              {x.name}
                            </button>
                            {x.description && <p className="text-xs break-words text-muted-foreground">{x.description}</p>}
                          </div>
                        </div>
                      </td>
                      <td className={TD}>
                        <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${k.cls}`}>{k.label}</span>
                      </td>
                      <td className={`${TD} text-right whitespace-nowrap text-muted-foreground tabular-nums`}>{fmtSize(x.sizeBytes)}</td>
                      <td className={`${TD} whitespace-nowrap text-muted-foreground`}>{x.uploadedByName || t.unknown}</td>
                      <td className={`${TD} whitespace-nowrap text-muted-foreground`}>{fmtDate(x.updatedAt, lang)}</td>
                      <td className={`${TD} w-px pr-2`}>
                        <div className="flex items-center gap-0.5">
                          <Button variant="ghost" size="icon-sm" aria-label={t.download(x.name)} title={t.download(x.name)} onClick={() => void download(x)}>
                            <Download aria-hidden />
                          </Button>
                          <Button variant="ghost" size="icon-sm" aria-label={t.edit(x.name)} title={t.edit(x.name)} onClick={() => setDialog({ template: x })}>
                            <Pencil aria-hidden />
                          </Button>
                          {/* Soft delete with Undo in the toast, so no confirm step. */}
                          <Button variant="ghost" size="icon-sm" aria-label={t.del(x.name)} title={t.del(x.name)} disabled={del.isPending} onClick={() => del.mutate(x)}>
                            <Trash2 aria-hidden />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    );

  return (
    <section className="min-w-0 rounded-xl border bg-card shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <LayoutTemplate className="size-4 text-primary" aria-hidden />
        <span className="text-xs text-muted-foreground">{t.count(list.length)}</span>
        <div className="relative ml-auto min-w-40 flex-1 sm:max-w-64 sm:flex-none">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            aria-label={t.search}
            placeholder={t.search}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-full rounded-md border border-input bg-background pr-2 pl-8 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          />
        </div>
        <Button size="sm" onClick={() => setDialog({})}>
          <Plus aria-hidden />
          {t.upload}
        </Button>
      </div>
      {body}
      {dialog && (
        <TemplateDialog
          template={dialog.template}
          defaultCategory={dialog.category}
          categories={categories}
          onClose={() => setDialog(null)}
        />
      )}
    </section>
  );
}
