'use client';
import { useRef, useState, type KeyboardEvent } from 'react';
import { Input } from '@/components/ui/input';
import { SheetTitle } from '@/components/ui/sheet';
import { useT } from '../shared/i18n';
import { SaveStatus, useFlushOnUnmount, useInlineSave } from './inline';
import { useUpdateCard } from './mutations';

const TEXT = {
  th: { label: 'ชื่อการ์ด', required: 'ต้องกรอกชื่อการ์ด' },
  en: { label: 'Title', required: 'A title is required' },
};

export function TitleField({
  projectId,
  cardId,
  value,
  readOnly,
}: {
  projectId: number;
  cardId: number;
  value: string;
  readOnly: boolean;
}) {
  const t = useT(TEXT);
  const update = useUpdateCard(projectId, cardId);
  const { state, save, fail, clear } = useInlineSave(update.mutateAsync);
  const [draft, setDraft] = useState(value);
  // Enter/Escape and the blur that follows must save at most once, and never after Escape.
  const settled = useRef(false);

  // Follow server changes while not editing (e.g. the response of our own save).
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value);
  }

  useFlushOnUnmount(() => {
    const next = draft.trim();
    if (!readOnly && !settled.current && next && next !== value) update.mutate({ title: next });
  });

  if (readOnly) return <SheetTitle className="pr-8 text-xl font-semibold break-words">{value}</SheetTitle>;

  function commit(raw: string) {
    if (settled.current) return;
    settled.current = true;
    const next = raw.trim();
    if (!next) {
      fail((l) => TEXT[l].required);
      return;
    }
    setDraft(next);
    if (next !== value) void save({ title: next });
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) commit(e.currentTarget.value);
    else if (e.key === 'Escape') {
      settled.current = true;
      setDraft(value);
      clear();
    }
  };

  return (
    <div className="flex flex-col gap-1 pr-8">
      <Input
        value={draft}
        maxLength={200}
        aria-label={t.label}
        aria-invalid={state.kind === 'error'}
        onFocus={() => (settled.current = false)}
        onChange={(e) => {
          // Typing after a commit (Enter keeps focus) is a new edit that must save too.
          settled.current = false;
          setDraft(e.target.value);
        }}
        data-inline-edit
        data-dirty={draft !== value}
        onKeyDown={onKeyDown}
        onBlur={(e) => commit(e.currentTarget.value)}
        className="h-auto border-transparent px-2 py-1.5 text-xl font-semibold shadow-none hover:border-input md:text-xl"
      />
      <SaveStatus state={state} />
    </div>
  );
}
