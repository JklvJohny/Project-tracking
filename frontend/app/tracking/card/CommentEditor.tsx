'use client';
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useT } from '../shared/i18n';
import { SaveStatus, useInlineSave } from './inline';
import { insertMention, mentionQuery } from './mentions';

const TEXT = {
  th: { label: 'ความคิดเห็น', placeholder: 'เขียนความคิดเห็น พิมพ์ @ เพื่อกล่าวถึงสมาชิก', hint: 'Ctrl+Enter เพื่อส่ง', cancel: 'ยกเลิก', picker: 'สมาชิกที่กล่าวถึงได้' },
  en: { label: 'Comment', placeholder: 'Write a comment. Type @ to mention a member', hint: 'Ctrl+Enter to send', cancel: 'Cancel', picker: 'Members to mention' },
};

export type Mentionable = { id: number; name: string };

/**
 * Comment box with an @ member picker. Unsent text marks the field dirty (data-dirty) so the first Escape clears it
 * instead of closing the panel; it is never auto-sent on close (new content is only sent on purpose).
 * With `onCancel` (editing an existing comment) the first Escape calls it instead.
 * `onSubmit` rejects on failure, which keeps the text and shows the error inline.
 */
export function CommentEditor({
  members,
  onSubmit,
  submitLabel,
  initial = '',
  onCancel,
  autoFocus,
}: {
  members: Mentionable[];
  onSubmit: (text: string) => Promise<unknown>;
  submitLabel: string;
  initial?: string;
  onCancel?: () => void;
  autoFocus?: boolean;
}) {
  const t = useT(TEXT);
  const listId = useId();
  const box = useRef<HTMLTextAreaElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const [text, setText] = useState(initial);
  const [caret, setCaret] = useState(initial.length);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const { state, save } = useInlineSave(onSubmit);

  const q = dismissed ? null : mentionQuery(text, caret);
  const options = q ? members.filter((m) => m.name.toLowerCase().includes(q.query.toLowerCase())) : [];
  const open = options.length > 0;
  const current = Math.min(active, Math.max(0, options.length - 1));

  useLayoutEffect(() => {
    if (pendingCaret.current === null) return;
    box.current?.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  });

  function pick(userId: number) {
    const el = box.current;
    const r = insertMention(text, el?.selectionStart ?? caret, userId);
    pendingCaret.current = r.caret;
    setText(r.text);
    setCaret(r.caret);
    setActive(0);
    el?.focus();
  }

  async function send() {
    const body = text.trim();
    if (!body || state.kind === 'saving') return;
    if (await save(body)) {
      setText(initial);
      setCaret(initial.length);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing) return;
    if (open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((current + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length);
        return;
      }
      if ((e.key === 'Enter' && !e.ctrlKey && !e.metaKey) || e.key === 'Tab') {
        e.preventDefault();
        pick(options[current].id);
        return;
      }
      if (e.key === 'Escape') {
        // Only the picker closes; the dirty marker below keeps the panel open.
        e.preventDefault();
        setDismissed(true);
        return;
      }
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void send();
    } else if (e.key === 'Escape' && onCancel) {
      // Editing an existing comment: Escape leaves edit mode (the sheet ignores this Escape, see data-dirty).
      onCancel();
    } else if (e.key === 'Escape' && text !== initial) {
      setText(initial);
      setCaret(initial.length);
    }
  }

  const track = (el: HTMLTextAreaElement) => setCaret(el.selectionStart ?? el.value.length);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative">
        <Textarea
          ref={box}
          value={text}
          rows={3}
          maxLength={5000}
          autoFocus={autoFocus}
          aria-label={t.label}
          placeholder={t.placeholder}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open ? `${listId}-${current}` : undefined}
          data-inline-edit
          // Edit mode (onCancel) is always dirty: its first Escape cancels the edit instead of closing the panel.
          data-dirty={!!onCancel || text !== initial || open}
          onChange={(e) => {
            setText(e.target.value);
            track(e.target);
            setDismissed(false);
            setActive(0);
          }}
          onSelect={(e) => track(e.currentTarget)}
          onClick={(e) => track(e.currentTarget)}
          onKeyUp={(e) => track(e.currentTarget)}
          onKeyDown={onKeyDown}
        />
        {open && (
          <ul
            id={listId}
            role="listbox"
            aria-label={t.picker}
            className="absolute top-full right-0 left-0 z-20 mt-1 max-h-48 overflow-y-auto rounded-md border bg-popover p-1 text-sm shadow-md"
          >
            {options.map((m, i) => (
              <li
                key={m.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === current}
                className={`cursor-pointer truncate rounded px-2 py-1.5 ${i === current ? 'bg-accent text-accent-foreground' : ''}`}
                // mousedown, not click: the textarea must keep focus and its caret.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(m.id);
                }}
              >
                {m.name}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" disabled={!text.trim() || state.kind === 'saving'} onClick={() => void send()}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            {t.cancel}
          </Button>
        )}
        <span className="sr-only">{t.hint}</span>
        <span className="ml-auto" />
        <SaveStatus state={state} />
      </div>
    </div>
  );
}
