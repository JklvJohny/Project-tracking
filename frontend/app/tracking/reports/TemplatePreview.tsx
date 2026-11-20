'use client';
import { Download, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { apiBlob } from '../shared/api/client';
import { errorMessage } from '../shared/errors';
import { useLang, useT } from '../shared/i18n';
import { extLabel, type Template } from './template-queries';

const TEXT = {
  th: {
    desc: 'ตัวอย่างแม่แบบ',
    loading: 'กำลังเปิดตัวอย่าง…',
    failed: 'เปิดตัวอย่างไฟล์นี้ไม่ได้ ดาวน์โหลดไปเปิดในโปรแกรมแทน',
    download: 'ดาวน์โหลด',
    close: 'ปิด',
    sheets: 'ชีต',
    empty: 'ชีตนี้ว่าง',
    cut: (r: number, c: number) => `แสดงแค่ ${r} แถวและ ${c} คอลัมน์แรก ดาวน์โหลดเพื่อดูทั้งหมด`,
    approx: 'ตัวอย่างนี้จัดหน้าใกล้เคียงต้นฉบับ แต่อาจไม่ตรงทุกจุด',
  },
  en: {
    desc: 'Template preview',
    loading: 'Opening the preview…',
    failed: 'This file could not be previewed. Download it to open it in its app.',
    download: 'Download',
    close: 'Close',
    sheets: 'Sheets',
    empty: 'This sheet is empty',
    cut: (r: number, c: number) => `Showing the first ${r} rows and ${c} columns. Download it to see everything.`,
    approx: 'The layout is close to the original but may differ in places.',
  },
};

type Previewable = 'pdf' | 'docx' | 'xlsx';

/** Formats the browser can show. The legacy Office formats and PowerPoint have no free in-browser renderer. */
export function previewKind(t: Pick<Template, 'filename'>): Previewable | null {
  const ext = extLabel(t).toLowerCase();
  return ext === 'pdf' || ext === 'docx' || ext === 'xlsx' ? ext : null;
}

/**
 * Fetched with the api auth headers (the dev X-User-ID cannot ride on an iframe src); see DocViewer. A PDF also gets
 * an object URL for the browser's viewer, revoked when the template changes or the preview closes.
 */
function useTemplateBlob(id: number, pdf: boolean) {
  const [state, setState] = useState<{ id: number; blob?: Blob; url?: string; error?: unknown }>({ id });
  useEffect(() => {
    const ctl = new AbortController();
    let url: string | undefined;
    apiBlob(`/report-templates/${id}/file`, { signal: ctl.signal })
      .then((blob) => {
        if (ctl.signal.aborted) return;
        // The server labels the type, but a proxy may not: the PDF viewer needs it.
        if (pdf) url = URL.createObjectURL(blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' }));
        setState({ id, blob, url });
      })
      .catch((error) => !ctl.signal.aborted && setState({ id, error }));
    return () => {
      ctl.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, pdf]);
  return state.id === id ? state : { id };
}

const SAFE_HREF = /^(https?:|mailto:|#)/i;

/**
 * docx-preview builds the document as DOM and adds its own <style> tags. It renders into a sandboxed iframe (no
 * scripts) so those styles cannot leak into the page and nothing in the file can run; links that are not plain
 * web or mail links are dropped.
 */
function DocxView({ blob, title, onError }: { blob: Blob; title: string; onError: (e: unknown) => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const doc = frame.current?.contentDocument;
    if (!ready || !doc) return;
    let cancelled = false;
    import('docx-preview')
      .then(({ renderAsync }) => renderAsync(blob, doc.body, doc.head, { inWrapper: true, ignoreLastRenderedPageBreak: true }))
      .then(() => {
        if (cancelled) return;
        doc.querySelectorAll('a').forEach((a) => {
          const href = a.getAttribute('href') ?? '';
          if (!SAFE_HREF.test(href)) a.removeAttribute('href');
          else if (!href.startsWith('#')) a.setAttribute('target', '_blank');
        });
      })
      .catch((e) => !cancelled && onError(e));
    return () => {
      cancelled = true;
      doc.body.replaceChildren();
    };
  }, [blob, ready, onError]);
  return (
    <iframe
      ref={frame}
      title={title}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc="<!doctype html><html><head><meta charset='utf-8'><style>body{margin:0;background:#e5e7eb}</style></head><body></body></html>"
      onLoad={() => setReady(true)}
      className="size-full border-0"
    />
  );
}

const MAX_ROWS = 500;
const MAX_COLS = 40;

type Cell = { text: string; bold: boolean; align?: string; rowSpan?: number; colSpan?: number } | null;
type Sheet = { name: string; rows: Cell[][]; cols: number; cut: boolean };

const colName = (n: number) => {
  let s = '';
  for (let i = n; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
};
const colIndex = (letters: string) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const parseRef = (ref: string) => {
  const m = /^([A-Z]+)(\d+)$/.exec(ref)!;
  return { c: colIndex(m[1]), r: Number(m[2]) };
};

/** Reads an .xlsx into plain rows (text, bold, alignment, merges) for a React table; nothing in it is HTML. */
async function readWorkbook(blob: Blob): Promise<Sheet[]> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await blob.arrayBuffer());
  return wb.worksheets.map((ws) => {
    const nRows = Math.min(ws.rowCount, MAX_ROWS);
    const nCols = Math.min(ws.columnCount, MAX_COLS);
    const rows: Cell[][] = Array.from({ length: nRows }, (_, r) =>
      Array.from({ length: nCols }, (_, c) => {
        const cell = ws.getCell(r + 1, c + 1);
        return { text: cell.text ?? '', bold: cell.font?.bold === true, align: cell.alignment?.horizontal };
      }),
    );
    for (const range of (ws.model as { merges?: string[] }).merges ?? []) {
      const [from, to] = range.split(':').map(parseRef);
      if (from.r > nRows || from.c > nCols) continue;
      const lastR = Math.min(to.r, nRows);
      const lastC = Math.min(to.c, nCols);
      for (let r = from.r; r <= lastR; r++) for (let c = from.c; c <= lastC; c++) rows[r - 1][c - 1] = null;
      const top = ws.getCell(from.r, from.c);
      rows[from.r - 1][from.c - 1] = {
        text: top.text ?? '',
        bold: top.font?.bold === true,
        align: top.alignment?.horizontal,
        rowSpan: lastR - from.r + 1,
        colSpan: lastC - from.c + 1,
      };
    }
    return { name: ws.name, rows, cols: nCols, cut: ws.rowCount > MAX_ROWS || ws.columnCount > MAX_COLS };
  });
}

const ALIGN: Record<string, string> = { center: 'text-center', centerContinuous: 'text-center', right: 'text-right' };

function XlsxView({ blob, onError }: { blob: Blob; onError: (e: unknown) => void }) {
  const t = useT(TEXT);
  const [sheets, setSheets] = useState<Sheet[]>();
  const [active, setActive] = useState(0);
  const ids = useId();
  useEffect(() => {
    let cancelled = false;
    readWorkbook(blob)
      .then((s) => !cancelled && setSheets(s))
      .catch((e) => !cancelled && onError(e));
    return () => {
      cancelled = true;
    };
  }, [blob, onError]);
  if (!sheets) return <p className="p-6 text-sm text-muted-foreground">{t.loading}</p>;
  const sheet = sheets[active];
  return (
    <div className="flex size-full flex-col">
      {sheets.length > 1 && (
        <div role="tablist" aria-label={t.sheets} className="flex shrink-0 gap-1 overflow-x-auto border-b px-3 py-1.5">
          {sheets.map((s, i) => (
            <button
              key={s.name}
              type="button"
              role="tab"
              id={`${ids}-t${i}`}
              aria-selected={i === active}
              aria-controls={`${ids}-p`}
              onClick={() => setActive(i)}
              className={`shrink-0 rounded px-2.5 py-1 text-xs font-medium ${i === active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent'}`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      {sheet.cut && <p className="shrink-0 border-b bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">{t.cut(MAX_ROWS, MAX_COLS)}</p>}
      <div id={`${ids}-p`} role={sheets.length > 1 ? 'tabpanel' : undefined} aria-labelledby={sheets.length > 1 ? `${ids}-t${active}` : undefined} className="min-h-0 flex-1 overflow-auto">
        {sheet.rows.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">{t.empty}</p>
        ) : (
          <table className="border-collapse text-xs">
            <caption className="sr-only">{sheet.name}</caption>
            <thead className="sticky top-0 z-10 bg-muted">
              <tr>
                <th scope="col" className="sticky left-0 z-10 min-w-10 border bg-muted" />
                {Array.from({ length: sheet.cols }, (_, c) => (
                  <th key={c} scope="col" className="min-w-20 border px-2 py-1 font-medium text-muted-foreground">
                    {colName(c + 1)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sheet.rows.map((row, r) => (
                <tr key={r}>
                  <th scope="row" className="sticky left-0 border bg-muted px-2 py-1 text-right font-medium text-muted-foreground tabular-nums">
                    {r + 1}
                  </th>
                  {row.map(
                    (cell, c) =>
                      cell && (
                        <td
                          key={c}
                          rowSpan={cell.rowSpan}
                          colSpan={cell.colSpan}
                          className={`max-w-80 border px-2 py-1 align-top whitespace-pre-wrap ${cell.bold ? 'font-semibold' : ''} ${ALIGN[cell.align ?? ''] ?? ''}`}
                        >
                          {cell.text}
                        </td>
                      ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export function TemplatePreview({ template, onDownload, onClose }: { template: Template; onDownload: () => void; onClose: () => void }) {
  const t = useT(TEXT);
  const { lang } = useLang();
  const kind = previewKind(template);
  const { blob, url, error } = useTemplateBlob(template.id, kind === 'pdf');
  const [renderError, setRenderError] = useState<{ id: number; error: unknown }>();
  // Stable, so the renderers' effects do not rerun on every render.
  const [onError] = useState(() => (e: unknown) => setRenderError({ id: template.id, error: e }));
  const failed = error ?? (renderError?.id === template.id ? renderError.error : undefined);

  let body;
  if (failed || !kind)
    body = (
      <div role="alert" className="flex flex-col items-center gap-3 p-10 text-center">
        <p className="text-sm">{t.failed}</p>
        {error !== undefined && <p className="text-xs text-muted-foreground">{errorMessage(error, lang)}</p>}
        <Button variant="outline" onClick={onDownload}>
          <Download aria-hidden />
          {t.download}
        </Button>
      </div>
    );
  else if (!blob)
    body = (
      <p role="status" className="p-6 text-sm text-muted-foreground">
        {t.loading}
      </p>
    );
  else if (kind === 'pdf') body = <iframe title={template.name} src={url} className="size-full border-0" />;
  else if (kind === 'docx') body = <DocxView blob={blob} title={template.name} onError={onError} />;
  else body = <XlsxView blob={blob} onError={onError} />;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[92vh] w-full max-w-6xl flex-col gap-0 p-0 sm:max-w-6xl" showCloseButton={false}>
        <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-sm font-semibold">{template.name}</DialogTitle>
            <DialogDescription className="truncate text-xs">
              {template.filename}
              {kind === 'docx' && !failed && ` · ${t.approx}`}
            </DialogDescription>
          </div>
          <Button variant="outline" size="sm" onClick={onDownload}>
            <Download aria-hidden />
            <span className="max-sm:sr-only">{t.download}</span>
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label={t.close} title={t.close} onClick={onClose}>
            <X aria-hidden />
          </Button>
        </div>
        <div className="min-h-0 flex-1 bg-muted/40">{body}</div>
      </DialogContent>
    </Dialog>
  );
}
