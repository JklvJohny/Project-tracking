'use client';
import { Check, Pencil, Plus, Tag } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { LABEL_CLASS } from '../board/CardPreview';
import type { components } from '../shared/api/schema';
import { useConfirm } from '../shared/confirm';
import { useT } from '../shared/i18n';
import { SaveStatus, useInlineSave } from './inline';
import { useCardLabel, useLabelCrud } from './mutations';

type S = components['schemas'];
type Color = S['LabelColor'];

const COLORS: Color[] = ['green', 'yellow', 'red', 'blue', 'purple', 'gray'];
const COLOR_TEXT = {
  th: { green: 'เขียว', yellow: 'เหลือง', red: 'แดง', blue: 'น้ำเงิน', purple: 'ม่วง', gray: 'เทา' },
  en: { green: 'Green', yellow: 'Yellow', red: 'Red', blue: 'Blue', purple: 'Purple', gray: 'Gray' },
};

const TEXT = {
  th: {
    labels: 'ป้ายกำกับ',
    manage: 'จัดการป้ายกำกับ',
    none: 'ยังไม่มีป้ายกำกับ',
    noLabels: 'โปรเจกต์นี้ยังไม่มีป้ายกำกับ',
    create: 'สร้างป้ายกำกับ',
    edit: (n: string) => `แก้ไขป้ายกำกับ ${n}`,
    name: 'ชื่อป้ายกำกับ',
    color: 'สี',
    save: 'บันทึก',
    cancel: 'ยกเลิก',
    delete: 'ลบ',
    confirmTitle: (n: string) => `ลบป้ายกำกับ ${n}?`,
    confirmBody: 'ป้ายกำกับนี้จะถูกเอาออกจากทุกการ์ดในโปรเจกต์',
  },
  en: {
    labels: 'Labels',
    manage: 'Manage labels',
    none: 'No labels',
    noLabels: 'This project has no labels yet',
    create: 'Create label',
    edit: (n: string) => `Edit label ${n}`,
    name: 'Label name',
    color: 'Color',
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    confirmTitle: (n: string) => `Delete label ${n}?`,
    confirmBody: 'This label will be removed from every card in the project.',
  },
};

function Chip({ label }: { label: S['BoardLabel'] }) {
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${LABEL_CLASS[label.color]}`}>
      {label.name}
    </span>
  );
}

function LabelForm({
  initial,
  onDone,
  onSubmit,
  onDelete,
}: {
  initial: { name: string; color: Color };
  onDone: () => void;
  onSubmit: (v: { name: string; color: Color }) => Promise<unknown>;
  onDelete?: { ask: () => Promise<boolean>; run: () => Promise<unknown> };
}) {
  const t = useT(TEXT);
  const colorText = useT(COLOR_TEXT);
  const [name, setName] = useState(initial.name);
  const [color, setColor] = useState<Color>(initial.color);
  const { state, save } = useInlineSave<() => Promise<unknown>>((fn) => fn());

  async function submit() {
    const n = name.trim();
    if (!n) return;
    if (await save(() => onSubmit({ name: n, color }))) onDone();
  }

  return (
    <form
      className="flex flex-col gap-2 rounded-md border p-2"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Input
        autoFocus
        value={name}
        maxLength={40}
        aria-label={t.name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            // Close the form, not the whole panel.
            e.stopPropagation();
            onDone();
          }
        }}
      />
      <div role="radiogroup" aria-label={t.color} className="flex gap-1.5">
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={color === c}
            aria-label={colorText[c]}
            title={colorText[c]}
            onClick={() => setColor(c)}
            className={`grid size-6 place-content-center rounded-full ring-offset-2 ring-offset-popover outline-none focus-visible:ring-2 focus-visible:ring-ring ${LABEL_CLASS[c]} ${
              color === c ? 'ring-2 ring-foreground' : ''
            }`}
          >
            {color === c && <Check className="size-3" aria-hidden />}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" size="xs" disabled={!name.trim()}>
          {t.save}
        </Button>
        <Button type="button" size="xs" variant="ghost" onClick={onDone}>
          {t.cancel}
        </Button>
        {onDelete && (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            className="ml-auto text-destructive"
            onClick={() => void (async () => {
              if ((await onDelete.ask()) && (await save(onDelete.run))) onDone();
            })()}
          >
            {t.delete}
          </Button>
        )}
      </div>
      <SaveStatus state={state} />
    </form>
  );
}

export function LabelPicker({
  projectId,
  card,
  labels,
  readOnly,
  canManage,
}: {
  projectId: number;
  card: S['CardDetail'];
  labels: S['BoardLabel'][];
  readOnly: boolean;
  /** PM or admin: create, rename, recolour and delete labels. */
  canManage: boolean;
}) {
  const t = useT(TEXT);
  const confirm = useConfirm();
  const toggle = useCardLabel(projectId, card.id);
  const { state, save } = useInlineSave(toggle.mutateAsync);
  const crud = useLabelCrud(projectId);
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const applied = card.labelIds.map((id) => labels.find((l) => l.id === id)).filter((l) => !!l);

  const ask = (l: S['BoardLabel']) =>
    confirm({ title: t.confirmTitle(l.name), description: t.confirmBody, destructive: true, confirmLabel: t.delete });

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{t.labels}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {applied.length === 0 && <span className="text-sm text-muted-foreground">{t.none}</span>}
        <ul className="contents">
          {applied.map((l) => (
            <li key={l.id}>
              <Chip label={l} />
            </li>
          ))}
        </ul>
        {!readOnly && (
          <Popover onOpenChange={(o) => !o && setEditing(null)}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="icon-sm" aria-label={t.manage} title={t.manage}>
                <Tag aria-hidden />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="flex w-72 flex-col gap-1.5 p-2">
              {labels.length === 0 && <p className="px-1 py-2 text-sm text-muted-foreground">{t.noLabels}</p>}
              <ul className="flex flex-col gap-1">
                {labels.map((l) => {
                  const on = card.labelIds.includes(l.id);
                  return (
                    <li key={l.id}>
                      {editing === l.id ? (
                        <LabelForm
                          initial={l}
                          onDone={() => setEditing(null)}
                          onSubmit={(v) => crud.update.mutateAsync({ id: l.id, ...v })}
                          onDelete={{ ask: () => ask(l), run: () => crud.remove.mutateAsync(l.id) }}
                        />
                      ) : (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            aria-pressed={on}
                            onClick={() => void save({ labelId: l.id, on: !on })}
                            className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <Check className={`size-4 shrink-0 ${on ? '' : 'opacity-0'}`} aria-hidden />
                            <Chip label={l} />
                          </button>
                          {canManage && (
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              aria-label={t.edit(l.name)}
                              title={t.edit(l.name)}
                              onClick={() => setEditing(l.id)}
                            >
                              <Pencil aria-hidden />
                            </Button>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              {canManage &&
                (editing === 'new' ? (
                  <LabelForm
                    initial={{ name: '', color: 'blue' }}
                    onDone={() => setEditing(null)}
                    onSubmit={(v) => crud.create.mutateAsync(v)}
                  />
                ) : (
                  <Button variant="ghost" size="sm" className="justify-start" onClick={() => setEditing('new')}>
                    <Plus aria-hidden />
                    {t.create}
                  </Button>
                ))}
              <SaveStatus state={state} />
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  );
}
