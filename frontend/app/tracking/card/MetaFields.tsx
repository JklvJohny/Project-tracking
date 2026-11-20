'use client';
import { X } from 'lucide-react';
import { useRef, useState, type KeyboardEvent } from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { components } from '../shared/api/schema';
import { fmtDate, priorityLabel, type Priority } from '../shared/format';
import { useLang, useT } from '../shared/i18n';
import { SaveStatus, useFlushOnUnmount, useInlineSave } from './inline';
import { useUpdateCard } from './mutations';

type S = components['schemas'];

const TEXT = {
  th: { priority: 'ความสำคัญ', start: 'วันเริ่มต้น', due: 'วันครบกำหนด', none: 'ไม่ระบุ', clear: (f: string) => `ล้าง${f}` },
  en: { priority: 'Priority', start: 'Start date', due: 'Due date', none: 'Not set', clear: (f: string) => `Clear ${f.toLowerCase()}` },
};

const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'urgent'];

function DateField({
  label,
  value,
  readOnly,
  onSave,
}: {
  label: string;
  value: string | null;
  readOnly: boolean;
  onSave: (v: string | null) => Promise<boolean>;
}) {
  const { lang } = useLang();
  const t = useT(TEXT);
  const [draft, setDraft] = useState(value ?? '');
  const settled = useRef(false);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value ?? '');
  }

  // Close flushes a changed, complete date only; an empty draft is never flushed as a clear.
  useFlushOnUnmount(() => {
    if (!readOnly && !settled.current && draft && draft !== (value ?? '')) void onSave(draft);
  });

  if (readOnly)
    return <p className="text-sm">{value ? fmtDate(value, lang) : <span className="text-muted-foreground">{t.none}</span>}</p>;

  async function commit(el: HTMLInputElement) {
    if (settled.current) return;
    settled.current = true;
    const raw = el.value;
    // A partly typed date reads as '' with badInput set: it must not clear the stored date.
    if (el.validity.badInput || raw === (value ?? '')) return;
    // A rejected date (e.g. due before start) goes back to the server's value; the error stays visible.
    if (!(await onSave(raw || null))) setDraft(value ?? '');
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') void commit(e.currentTarget);
    else if (e.key === 'Escape') {
      settled.current = true;
      setDraft(value ?? '');
    }
  };
  // The native field draws its digits in the browser's locale (11/16/2026 on an English Windows), whatever the
  // app language. Its text is hidden and the app's own format is drawn over it; a click opens the picker.
  return (
    <div className="relative">
      <Input
        type="date"
        aria-label={label}
        value={draft}
        onFocus={() => (settled.current = false)}
        onClick={(e) => e.currentTarget.showPicker?.()}
        onChange={(e) => {
          settled.current = false;
          setDraft(e.target.value);
        }}
        data-inline-edit
        data-dirty={draft !== (value ?? '')}
        onKeyDown={onKeyDown}
        onBlur={(e) => void commit(e.currentTarget)}
        className="w-full cursor-pointer text-transparent [&::-webkit-datetime-edit]:text-transparent"
      />
      <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm">
        {draft ? fmtDate(draft, lang) : <span className="text-muted-foreground">{t.none}</span>}
      </span>
      {value && (
        <button
          type="button"
          aria-label={t.clear(label)}
          title={t.clear(label)}
          onClick={() => {
            settled.current = true;
            setDraft('');
            void onSave(null).then((ok) => !ok && setDraft(value ?? ''));
          }}
          className="absolute top-1/2 right-9 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}

export function MetaFields({
  projectId,
  card,
  readOnly,
}: {
  projectId: number;
  card: S['CardDetail'];
  readOnly: boolean;
}) {
  const t = useT(TEXT);
  const { lang } = useLang();
  const update = useUpdateCard(projectId, card.id);
  const { state, save } = useInlineSave(update.mutateAsync);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">{t.priority}</span>
        {readOnly ? (
          <p className="text-sm">{priorityLabel(card.priority, lang)}</p>
        ) : (
          <Select value={card.priority} onValueChange={(p) => void save({ priority: p as Priority })}>
            <SelectTrigger aria-label={t.priority} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRIORITIES.map((p) => (
                <SelectItem key={p} value={p}>
                  {priorityLabel(p, lang)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">{t.start}</span>
        <DateField label={t.start} value={card.startDate} readOnly={readOnly} onSave={(v) => save({ startDate: v })} />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">{t.due}</span>
        <DateField label={t.due} value={card.dueDate} readOnly={readOnly} onSave={(v) => save({ dueDate: v })} />
      </div>
      {!readOnly && <SaveStatus state={state} />}
    </div>
  );
}
