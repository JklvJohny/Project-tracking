'use client';
import { useT } from '../shared/i18n';
import type { components } from '../shared/api/schema';

type Status = components['schemas']['ProjectStatus'] | 'archived';

const TEXT = {
  th: { active: 'กำลังดำเนินการ', on_hold: 'พักไว้', done: 'เสร็จสิ้น', archived: 'เก็บถาวร' },
  en: { active: 'Active', on_hold: 'On hold', done: 'Done', archived: 'Archived' },
};

// Colours come from the --s-* status tokens; the dot is decorative, the label carries the meaning.
const DOT: Record<Status, string> = {
  active: 'bg-[var(--s-active)]',
  on_hold: 'bg-[var(--s-todo)]',
  done: 'bg-[var(--s-done)]',
  archived: 'bg-muted-foreground',
};

export function StatusBadge({ status }: { status: Status }) {
  const t = useT(TEXT);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium">
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${DOT[status]}`} />
      {t[status]}
    </span>
  );
}
