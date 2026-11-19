'use client';
import { Plus, X } from 'lucide-react';
import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage } from '../shared/errors';
import { useLang, useT } from '../shared/i18n';
import { useCreateCard } from './mutations';

const TEXT = {
  th: {
    open: 'เพิ่มการ์ด',
    placeholder: 'ใส่ชื่อการ์ด…',
    label: (list: string) => `ชื่อการ์ดใหม่ในลิสต์ ${list}`,
    submit: 'เพิ่มการ์ด',
    cancel: 'ยกเลิก',
    hint: 'Enter เพื่อเพิ่ม · Esc เพื่อยกเลิก',
  },
  en: {
    open: 'Add card',
    placeholder: 'Enter a title for this card…',
    label: (list: string) => `New card title in ${list}`,
    submit: 'Add card',
    cancel: 'Cancel',
    hint: 'Enter to add · Esc to cancel',
  },
};

export function AddCard({ projectId, listId, listName }: { projectId: number; listId: number; listName: string }) {
  const t = useT(TEXT);
  const { lang } = useLang();
  const create = useCreateCard(projectId);
  const [open, setOpen] = useState(false);
  // The error itself, not its text: the message is resolved at render so it follows a language switch.
  const [error, setError] = useState<unknown>(null);

  if (!open)
    return (
      <div className="p-2 pt-1">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-bold tracking-wide text-primary uppercase hover:bg-primary/10"
        >
          <Plus className="size-4" aria-hidden />
          {t.open}
        </button>
      </div>
    );

  function submit(form: HTMLFormElement) {
    const ta = form.elements.namedItem('title') as HTMLTextAreaElement;
    const title = ta.value.trim();
    if (!title || create.isPending) return;
    setError(null);
    create.mutate(
      { listId, title },
      {
        onSuccess: () => {
          ta.value = '';
          ta.focus(); // stay open for the next card
        },
        onError: setError,
      },
    );
  }
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    submit(e.currentTarget);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // isComposing: Enter confirms a Thai/IME composition and must not submit.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit(e.currentTarget.form!);
    } else if (e.key === 'Escape') setOpen(false);
  };

  return (
    <form onSubmit={onSubmit} className="p-2 pt-1">
      <Textarea
        name="title"
        rows={2}
        autoFocus
        maxLength={200}
        placeholder={t.placeholder}
        aria-label={t.label(listName)}
        onKeyDown={onKeyDown}
        className="resize-none bg-card"
      />
      {error != null && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {errorMessage(error, lang)}
        </p>
      )}
      <div className="mt-1.5 flex items-center gap-1.5">
        <Button type="submit" size="sm" disabled={create.isPending}>
          {t.submit}
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={t.cancel} onClick={() => setOpen(false)}>
          <X aria-hidden />
        </Button>
        <span className="sr-only">{t.hint}</span>
      </div>
    </form>
  );
}
