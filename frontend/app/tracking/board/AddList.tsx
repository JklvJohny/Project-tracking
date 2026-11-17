'use client';
import { Plus, X } from 'lucide-react';
import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { errorMessage } from '../shared/errors';
import { useLang, useT } from '../shared/i18n';
import { useCreateList } from './mutations';

const TEXT = {
  th: { open: 'เพิ่มลิสต์', placeholder: 'ชื่อลิสต์', label: 'ชื่อลิสต์ใหม่', submit: 'เพิ่มลิสต์', cancel: 'ยกเลิก' },
  en: { open: 'Add list', placeholder: 'List name', label: 'New list name', submit: 'Add list', cancel: 'Cancel' },
};

/** Fixed column width, shared with the skeleton so the loading state does not shift layout. */
export const COLUMN_W = 'w-[min(18rem,calc(100vw-3rem))] shrink-0';

export function AddList({ projectId }: { projectId: number }) {
  const t = useT(TEXT);
  const { lang } = useLang();
  const create = useCreateList(projectId);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${COLUMN_W} flex h-11 items-center gap-1.5 rounded-xl border border-dashed px-3 text-sm font-medium text-muted-foreground hover:border-solid hover:bg-muted/50 hover:text-foreground`}
      >
        <Plus className="size-4" aria-hidden />
        {t.open}
      </button>
    );

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem('name') as HTMLInputElement;
    const name = input.value.trim();
    if (!name || create.isPending) return;
    setError(null);
    create.mutate(name, {
      onSuccess: () => setOpen(false),
      onError: (err) => setError(errorMessage(err, lang)),
    });
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') setOpen(false);
  };

  return (
    <form onSubmit={onSubmit} className={`${COLUMN_W} rounded-xl border bg-muted/50 p-2`}>
      <Input name="name" autoFocus maxLength={100} placeholder={t.placeholder} aria-label={t.label} onKeyDown={onKeyDown} />
      {error && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="mt-2 flex gap-1.5">
        <Button type="submit" size="sm" disabled={create.isPending}>
          {t.submit}
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={t.cancel} onClick={() => setOpen(false)}>
          <X aria-hidden />
        </Button>
      </div>
    </form>
  );
}
