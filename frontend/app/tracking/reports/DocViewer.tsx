'use client';
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { apiBlob } from '../shared/api/client';
import { errorMessage } from '../shared/errors';
import { useLang, useT } from '../shared/i18n';
import type { Doc } from './queries';

const TEXT = {
  th: { prev: 'ก่อนหน้า', next: 'ถัดไป', download: 'ดาวน์โหลด', close: 'ปิด', loading: 'กำลังโหลดเอกสาร…', of: (i: number, n: number) => `${i} จาก ${n}`, desc: 'ตัวอ่านเอกสาร PDF' },
  en: { prev: 'Previous', next: 'Next', download: 'Download', close: 'Close', loading: 'Loading document…', of: (i: number, n: number) => `${i} of ${n}`, desc: 'PDF document viewer' },
};

/**
 * Local dev auth is an X-User-ID header, which an <iframe src> and <a download> cannot send, so the file is fetched
 * with the api auth headers as a Blob and shown through an object URL (revoked when the document changes or the
 * viewer closes). In production the host's session cookie would let the iframe point straight at
 * /api/tracking/v1/documents/{id}/file, but the blob path works in both, so it is the only path.
 */
function useBlobUrl(id: number) {
  const [state, setState] = useState<{ id: number; url?: string; error?: unknown }>({ id });
  useEffect(() => {
    const ctl = new AbortController();
    let url: string | undefined;
    apiBlob(`/documents/${id}/file`, { signal: ctl.signal })
      .then((b) => {
        if (ctl.signal.aborted) return;
        url = URL.createObjectURL(b);
        setState({ id, url });
      })
      .catch((error) => {
        if (!ctl.signal.aborted) setState({ id, error });
      });
    return () => {
      ctl.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [id]);
  // A stale url from the previous document must never be shown for the new one.
  return state.id === id ? state : { id };
}

export function DocViewer({ docs, index, onIndex, onClose }: { docs: Doc[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const t = useT(TEXT);
  const { lang } = useLang();
  const doc = docs[index];
  const { url, error } = useBlobUrl(doc.id);
  const go = (i: number) => i >= 0 && i < docs.length && onIndex(i);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="flex h-[92vh] w-full max-w-6xl flex-col gap-0 p-0 sm:max-w-6xl"
        showCloseButton={false}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') go(index + 1);
          else if (e.key === 'ArrowLeft') go(index - 1);
        }}
      >
        <div className="flex items-center gap-2 border-b px-4 py-2">
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-sm font-semibold">{doc.filename}</DialogTitle>
            <DialogDescription className="text-xs">
              {t.desc} · {t.of(index + 1, docs.length)}
            </DialogDescription>
          </div>
          <Button variant="ghost" size="icon" aria-label={t.prev} disabled={index === 0} onClick={() => go(index - 1)}>
            <ChevronLeft aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="icon" aria-label={t.next} disabled={index === docs.length - 1} onClick={() => go(index + 1)}>
            <ChevronRight aria-hidden="true" />
          </Button>
          {url ? (
            <Button variant="outline" size="sm" asChild>
              <a href={url} download={doc.filename}>
                <Download aria-hidden="true" />
                {t.download}
              </a>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>
              <Download aria-hidden="true" />
              {t.download}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X aria-hidden="true" />
            {t.close}
          </Button>
        </div>
        {error ? (
          <p role="alert" className="p-6 text-sm">
            {errorMessage(error, lang)}
          </p>
        ) : url ? (
          <iframe src={url} title={doc.filename} className="min-h-0 w-full flex-1 border-0 bg-muted" />
        ) : (
          <p role="status" className="p-6 text-sm text-muted-foreground">
            {t.loading}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
