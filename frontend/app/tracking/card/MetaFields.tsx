'use client';
import { useRef, useState, type KeyboardEvent } from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { components } from '../shared/api/schema';
import { fmtDate, priorityLabel, type Priority } from '../shared/format';
import { useLang, useT } from '../shared/i18n';
import { SaveStatus, useInlineSave } from './inline';
import { useUpdateCard } from './mutations';

type S = components['schemas'];

const TEXT = {
  th: { priority: 'ความสำคัญ', start: 'วันเริ่มต้น', due: 'วันครบกำหนด', none: 'ไม่ระบุ' },
  en: { priority: 'Priority', start: 'Start date', due: 'Due date', none: 'Not set' },
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

  if (readOnly)
    return <p className="text-sm">{value ? fmtDate(value, lang) : <span className="text-muted-foreground">{t.none}</span>}</p>;

  async function commit(raw: string) {
    if (settled.current) return;
    settled.current = true;
    if (raw === (value ?? '')) return;
    // A rejected date (e.g. due before start) goes back to the server's value; the error stays visible.
    if (!(await onSave(raw || null))) setDraft(value ?? '');
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') void commit(e.currentTarget.value);
    else if (e.key === 'Escape') {
      settled.current = true;
      setDraft(value ?? '');
    }
  };
  return (
    <Input
      type="date"
      aria-label={label}
      value={draft}
      onFocus={() => (settled.current = false)}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={(e) => void commit(e.currentTarget.value)}
      className="w-auto"
    />
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
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
      {!readOnly && (
        <div className="sm:col-span-3">
          <SaveStatus state={state} />
        </div>
      )}
    </div>
  );
}
