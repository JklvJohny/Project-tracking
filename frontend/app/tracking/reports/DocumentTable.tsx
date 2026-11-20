'use client';
import { Trash2 } from 'lucide-react';
import { useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Avatar } from '../shared/Avatar';
import { fmtDate } from '../shared/format';
import { useLang, useT } from '../shared/i18n';
import type { Doc } from './queries';

const TEXT = {
  th: {
    name: 'ชื่อไฟล์', size: 'ขนาด', by: 'อัปโหลดโดย', date: 'วันที่', actions: 'การทำงาน', del: 'ลบ',
    caption: 'เอกสารในโฟลเดอร์ ดับเบิลคลิกหรือกด Enter เพื่อเปิด', unknown: 'ผู้ใช้ไม่ทราบชื่อ',
  },
  en: {
    name: 'Name', size: 'Size', by: 'Uploaded by', date: 'Date', actions: 'Actions', del: 'Delete',
    caption: 'Documents in this folder. Double-click or press Enter to open.', unknown: 'Unknown user',
  },
};

export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type Props = {
  docs: Doc[];
  canDelete: (d: Doc) => boolean;
  onOpen: (index: number) => void;
  onDelete: (d: Doc) => void;
};

export function DocumentTable({ docs, canDelete, onOpen, onDelete }: Props) {
  const t = useT(TEXT);
  const { lang } = useLang();
  const [selected, setSelected] = useState<number | null>(null);
  const rows = useRef<(HTMLTableRowElement | null)[]>([]);

  const move = (to: number) => {
    const d = docs[to];
    if (!d) return;
    setSelected(d.id);
    rows.current[to]?.focus();
  };
  const onKey = (e: KeyboardEvent, i: number) => {
    // Keys pressed on the row's own Delete button belong to the button.
    if (e.target !== e.currentTarget) return;
    if (e.key === 'ArrowDown') move(i + 1);
    else if (e.key === 'ArrowUp') move(i - 1);
    else if (e.key === 'Enter') {
      setSelected(docs[i].id);
      onOpen(i);
    } else return;
    e.preventDefault();
  };

  return (
    <>
      <div className="relative overflow-x-auto">
        <table role="grid" className="w-full text-sm">
          <caption className="sr-only">{t.caption}</caption>
          <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">{t.name}</th>
              <th scope="col" className="hidden px-4 py-2 text-right font-medium sm:table-cell">{t.size}</th>
              <th scope="col" className="hidden px-4 py-2 font-medium md:table-cell">{t.by}</th>
              <th scope="col" className="hidden px-4 py-2 font-medium sm:table-cell">{t.date}</th>
              <th scope="col" className="w-12 px-2"><span className="sr-only">{t.actions}</span></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {docs.map((d, i) => {
              const name = d.uploadedByName || `${t.unknown} #${d.uploadedBy}`;
              const sel = selected === d.id;
              return (
                <tr
                  key={d.id}
                  ref={(el) => {
                    rows.current[i] = el;
                  }}
                  tabIndex={sel || (selected === null && i === 0) ? 0 : -1}
                  aria-selected={sel}
                  onClick={() => setSelected(d.id)}
                  onDoubleClick={() => (setSelected(d.id), onOpen(i))}
                  onKeyDown={(e) => onKey(e, i)}
                  className="cursor-default select-none outline-none hover:bg-muted/50 focus-visible:bg-muted aria-selected:bg-primary/10"
                >
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2.5">
                      <span aria-hidden="true" className="flex h-8 w-7 shrink-0 items-center justify-center rounded bg-destructive/10 text-[9px] font-bold text-destructive">
                        PDF
                      </span>
                      <span className="min-w-0 truncate font-medium">{d.filename}</span>
                    </span>
                  </td>
                  <td className="hidden whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-muted-foreground sm:table-cell">{fmtSize(d.sizeBytes)}</td>
                  <td className="hidden px-4 py-2.5 md:table-cell">
                    <span className="flex items-center gap-2">
                      <Avatar user={{ id: d.uploadedBy, name }} size="xs" />
                      <span className="truncate">{name}</span>
                    </span>
                  </td>
                  <td className="hidden whitespace-nowrap px-4 py-2.5 text-muted-foreground sm:table-cell">{fmtDate(d.createdAt, lang)}</td>
                  <td className="px-2 py-2.5 text-right">
                    {canDelete(d) && (
                      <Button variant="ghost" size="icon" aria-label={t.del} title={t.del} onClick={(e) => (e.stopPropagation(), onDelete(d))}>
                        <Trash2 aria-hidden="true" />
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
