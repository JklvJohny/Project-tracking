'use client';
import { useT } from './i18n';

export type PillStatus = 'active' | 'on_hold' | 'done' | 'archived';

const TEXT = {
  th: { active: 'กำลังดำเนินการ', on_hold: 'พักไว้', done: 'เสร็จสิ้น', archived: 'เก็บถาวร' },
  en: { active: 'Active', on_hold: 'On hold', done: 'Done', archived: 'Archived' },
};

// Colours are the --sp-* tokens; the dot is decorative, the label carries the meaning.
export function StatusPill({ status }: { status: PillStatus }) {
  const t = useT(TEXT);
  return (
    <span
      style={{ backgroundColor: `var(--sp-${status}-bg)`, color: `var(--sp-${status}-fg)` }}
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
    >
      <span aria-hidden="true" style={{ backgroundColor: `var(--sp-${status}-dot)` }} className="h-1.5 w-1.5 rounded-full" />
      {t[status]}
    </span>
  );
}
