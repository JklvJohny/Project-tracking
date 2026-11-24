'use client';
import { Loader2, Upload } from 'lucide-react';
import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { ApiError } from '../shared/api/client';
import { errorKey, errorText } from '../shared/errors';
import { useLang, useT } from '../shared/i18n';
import { MAX_BYTES, useUploadDocument } from './queries';

const TEXT = {
  th: { upload: 'อัปโหลด PDF', uploading: 'กำลังอัปโหลด…', drop: 'วางไฟล์ PDF เพื่ออัปโหลด', input: 'เลือกไฟล์ PDF' },
  en: { upload: 'Upload PDF', uploading: 'Uploading…', drop: 'Drop a PDF to upload', input: 'Choose a PDF file' },
};

/** Quick client-side check; the server repeats both (422 too_large / not_pdf). */
export function checkPdf(f: File): 'not_pdf' | 'too_large' | null {
  if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) return 'not_pdf';
  return f.size > MAX_BYTES ? 'too_large' : null;
}

// The server reports file problems as 422 fields.file; everything else is an envelope code.
const codeOf = (e: unknown) => (e instanceof ApiError ? (e.fields?.file ?? errorKey(e)) : 'server_error');

/** Wraps the document table: a button and drag & drop. Render only for editors. */
export function UploadZone({ projectId, children }: { projectId: number; children: ReactNode }) {
  const t = useT(TEXT);
  const { lang } = useLang();
  const up = useUploadDocument(projectId);
  const inputRef = useRef<HTMLInputElement>(null);
  // A code, resolved at render, so the message follows a language switch.
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  const send = (f: File | undefined) => {
    if (!f) return;
    const bad = checkPdf(f);
    if (bad) return setError(bad);
    setError(null);
    up.mutate(f, { onError: (e) => setError(codeOf(e)) });
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    send(e.dataTransfer.files[0]);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={`relative ${over ? 'rounded-xl ring-2 ring-primary' : ''}`}
    >
      <div className="flex items-center justify-end gap-3 px-3 pt-3">
        {error && (
          <p role="alert" className="mr-auto text-sm text-destructive">
            {errorText(error, lang)}
          </p>
        )}
        <input
          ref={inputRef}
          data-testid="upload-input"
          type="file"
          accept="application/pdf,.pdf"
          aria-label={t.input}
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            send(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <Button size="sm" disabled={up.isPending} onClick={() => inputRef.current?.click()}>
          {up.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Upload aria-hidden="true" />}
          {up.isPending ? t.uploading : t.upload}
        </Button>
      </div>
      {children}
      {over && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-primary/10 text-sm font-medium">
          {t.drop}
        </div>
      )}
    </div>
  );
}
