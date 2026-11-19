'use client';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { useCard } from '../shared/api/queries';
import type { components } from '../shared/api/schema';
import { errorMessage } from '../shared/errors';
import { useLang, useT } from '../shared/i18n';
import { SaveStatus, useFlushOnUnmount, useInlineSave } from './inline';
import { useChecklist } from './mutations';

type Item = components['schemas']['ChecklistItem'];

const TEXT = {
  th: {
    title: 'เช็กลิสต์',
    progress: (d: number, n: number, p: number) => `${d}/${n} · ${p}%`,
    progressLabel: 'ความคืบหน้าเช็กลิสต์',
    text: (t: string) => `ข้อความรายการ: ${t}`,
    add: 'เพิ่มรายการ',
    addPlaceholder: 'เพิ่มรายการ แล้วกด Enter',
    del: (t: string) => `ลบรายการ ${t}`,
    up: (t: string) => `เลื่อนรายการ ${t} ขึ้น`,
    down: (t: string) => `เลื่อนรายการ ${t} ลง`,
    hint: 'Alt+ลูกศรขึ้น/ลง เพื่อเรียงลำดับ',
    empty: 'ยังไม่มีรายการ',
    required: 'ต้องกรอกข้อความ',
    moved: (t: string, i: number, n: number) => `ย้าย ${t} ไปลำดับที่ ${i} จาก ${n}`,
    deleted: 'ลบรายการแล้ว',
    undo: 'เลิกทำ',
  },
  en: {
    title: 'Checklist',
    progress: (d: number, n: number, p: number) => `${d}/${n} · ${p}%`,
    progressLabel: 'Checklist progress',
    text: (t: string) => `Item text: ${t}`,
    add: 'Add item',
    addPlaceholder: 'Add an item, press Enter',
    del: (t: string) => `Delete item ${t}`,
    up: (t: string) => `Move item ${t} up`,
    down: (t: string) => `Move item ${t} down`,
    hint: 'Alt+Arrow Up/Down to reorder',
    empty: 'No items yet',
    required: 'Text is required',
    moved: (t: string, i: number, n: number) => `Moved ${t} to position ${i} of ${n}`,
    deleted: 'Item deleted',
    undo: 'Undo',
  },
};

function ItemRow({
  item,
  index,
  count,
  readOnly,
  onToggle,
  onRename,
  onDelete,
  onMove,
}: {
  item: Item;
  index: number;
  count: number;
  readOnly: boolean;
  onToggle: (done: boolean) => void;
  onRename: (text: string) => Promise<boolean>;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const t = useT(TEXT);
  const [draft, setDraft] = useState(item.text);
  const [seen, setSeen] = useState(item.text);
  if (seen !== item.text) {
    setSeen(item.text);
    setDraft(item.text);
  }
  const settled = useRef(false);

  useFlushOnUnmount(() => {
    const text = draft.trim();
    if (!readOnly && !settled.current && text && text !== item.text) void onRename(text);
  });

  async function commit(raw: string) {
    if (settled.current) return;
    settled.current = true;
    const text = raw.trim();
    if (!text || text === item.text) {
      setDraft(item.text);
      return;
    }
    if (!(await onRename(text))) setDraft(item.text);
  }
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      onMove(e.key === 'ArrowUp' ? -1 : 1);
    }
  };

  return (
    <li data-item={item.id} className="flex items-center gap-2 py-1" onKeyDown={readOnly ? undefined : onKeyDown}>
      <Checkbox
        checked={item.isDone}
        disabled={readOnly}
        aria-label={item.text}
        onCheckedChange={(v) => onToggle(v === true)}
      />
      {readOnly ? (
        <span className={`min-w-0 flex-1 text-sm break-words ${item.isDone ? 'text-muted-foreground line-through' : ''}`}>
          {item.text}
        </span>
      ) : (
        <>
          <Input
            value={draft}
            maxLength={500}
            aria-label={t.text(item.text)}
            aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
            onFocus={() => (settled.current = false)}
            onChange={(e) => {
              settled.current = false;
              setDraft(e.target.value);
            }}
            data-inline-edit
            data-dirty={draft !== item.text}
            onBlur={(e) => void commit(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) void commit(e.currentTarget.value);
              else if (e.key === 'Escape') {
                settled.current = true;
                setDraft(item.text);
              }
            }}
            className={`h-7 flex-1 border-transparent px-1.5 shadow-none hover:border-input ${
              item.isDone ? 'text-muted-foreground line-through' : ''
            }`}
          />
          <Button variant="ghost" size="icon-xs" aria-label={t.up(item.text)} title={t.up(item.text)} disabled={index === 0} onClick={() => onMove(-1)}>
            <ArrowUp aria-hidden />
          </Button>
          <Button variant="ghost" size="icon-xs" aria-label={t.down(item.text)} title={t.down(item.text)} disabled={index === count - 1} onClick={() => onMove(1)}>
            <ArrowDown aria-hidden />
          </Button>
          <Button variant="ghost" size="icon-xs" aria-label={t.del(item.text)} title={t.del(item.text)} onClick={onDelete}>
            <Trash2 aria-hidden />
          </Button>
        </>
      )}
    </li>
  );
}

export function Checklist({
  projectId,
  cardId,
  readOnly,
  focusAdd = false,
  onFocusHandled,
}: {
  projectId: number;
  cardId: number;
  readOnly: boolean;
  /** Focus the add-item input once on mount (the card preview's "+" link). */
  focusAdd?: boolean;
  onFocusHandled?: () => void;
}) {
  const t = useT(TEXT);
  const { lang } = useLang();
  const items = useCard(cardId).data?.checklist ?? [];
  const cl = useChecklist(projectId, cardId);
  const { state, save, fail } = useInlineSave<() => Promise<unknown>>((fn) => fn());
  const root = useRef<HTMLElement>(null);
  const [announce, setAnnounce] = useState('');
  const [newText, setNewText] = useState('');
  const addRef = useRef<HTMLInputElement>(null);
  const handled = useRef(false);
  useEffect(() => {
    if (!focusAdd || handled.current) return;
    handled.current = true;
    addRef.current?.focus();
    onFocusHandled?.();
  }, [focusAdd, onFocusHandled]);
  const done = items.filter((i) => i.isDone).length;
  const pct = items.length ? Math.round((done / items.length) * 100) : 0;

  function move(index: number, dir: -1 | 1) {
    const to = index + dir;
    if (to < 0 || to >= items.length) return;
    const item = items[index];
    const rest = items.filter((_, i) => i !== index);
    // beforeId = item that ends up immediately above, afterId = immediately below (same contract as cards).
    const beforeId = rest[to - 1]?.id ?? null;
    const afterId = rest[to]?.id ?? null;
    // Reordering moves the DOM node, which drops focus in some browsers; put it back on the moved row.
    requestAnimationFrame(() => root.current?.querySelector<HTMLInputElement>(`[data-item="${item.id}"] input`)?.focus());
    setAnnounce(t.moved(item.text, to + 1, items.length));
    void save(() => cl.move.mutateAsync({ id: item.id, beforeId, afterId }));
  }

  async function add() {
    const text = newText.trim();
    if (!text) return fail((l) => TEXT[l].required);
    setNewText('');
    if (!(await save(() => cl.add.mutateAsync(text)))) setNewText(text);
  }

  // A delete is one click, so it is undoable: the toast re-creates the item where it was.
  async function remove(index: number) {
    const item = items[index];
    const aboveId = items[index - 1]?.id ?? null;
    const belowId = items[index + 1]?.id ?? null;
    if (!(await save(() => cl.remove.mutateAsync(item.id)))) return;
    toast(t.deleted, {
      action: {
        label: t.undo,
        // The panel may be closed by now: hook-level cache updates still run, so await rather than use callbacks.
        onClick: () => void cl.restore(item, aboveId, belowId).catch((e) => toast.error(errorMessage(e, lang))),
      },
    });
  }

  return (
    <section ref={root} aria-label={t.title} className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <h3 className="text-sm font-semibold">{t.title}</h3>
        <span className="text-xs text-muted-foreground tabular-nums">{t.progress(done, items.length, pct)}</span>
        <div
          role="progressbar"
          aria-label={t.progressLabel}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      </div>
      {items.length === 0 && <p className="text-sm text-muted-foreground">{t.empty}</p>}
      <ul>
        {items.map((item, i) => (
          <ItemRow
            key={item.id}
            item={item}
            index={i}
            count={items.length}
            readOnly={readOnly}
            onToggle={(v) => void save(() => cl.update.mutateAsync({ id: item.id, isDone: v }))}
            onRename={(text) => save(() => cl.update.mutateAsync({ id: item.id, text }))}
            onDelete={() => void remove(i)}
            onMove={(dir) => move(i, dir)}
          />
        ))}
      </ul>
      {!readOnly && (
        <>
          <Input
            ref={addRef}
            value={newText}
            maxLength={500}
            aria-label={t.add}
            placeholder={t.addPlaceholder}
            onChange={(e) => setNewText(e.target.value)}
            data-inline-edit
            data-dirty={newText !== ''}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setNewText('');
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void add();
              }
            }}
          />
          <p className="sr-only">{t.hint}</p>
          <SaveStatus state={state} />
        </>
      )}
      <span className="sr-only" aria-live="polite">
        {announce}
      </span>
    </section>
  );
}
