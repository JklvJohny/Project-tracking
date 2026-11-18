'use client';
import { ArrowDown, ArrowUp, ChevronsUp, Equal, type LucideIcon } from 'lucide-react';
import { priorityLabel, type Priority } from '../shared/format';
import { useLang, useT } from '../shared/i18n';
import type { Dashboard } from './queries';

const TEXT = {
  th: { title: 'งานที่ยังไม่เสร็จตามความสำคัญ' },
  en: { title: 'Open tasks by priority' },
};

// Each bar wears its --p-* token; the icon and the word on every row mean colour is never the only cue.
const ICON: Record<Priority, LucideIcon> = { urgent: ChevronsUp, high: ArrowUp, medium: Equal, low: ArrowDown };

export function PriorityBars({ rows }: { rows: Dashboard['byPriority'] }) {
  const t = useT(TEXT);
  const { lang } = useLang();
  const max = Math.max(1, ...rows.map((r) => r.open));
  return (
    <ul aria-label={t.title} className="space-y-2.5">
      {rows.map(({ priority, open }) => {
        const Icon = ICON[priority];
        return (
          <li key={priority} className="flex items-center gap-3">
            <span className="flex w-28 shrink-0 items-center gap-1.5 text-sm">
              <Icon className="h-4 w-4 shrink-0" style={{ color: `var(--p-${priority})` }} aria-hidden="true" />
              {priorityLabel(priority, lang)}
            </span>
            <div className="h-5 min-w-0 flex-1" aria-hidden="true">
              {open > 0 && (
                <div
                  className="h-full rounded-r"
                  title={`${priorityLabel(priority, lang)}: ${open}`}
                  style={{ width: `${(open / max) * 100}%`, background: `var(--p-${priority})` }}
                />
              )}
            </div>
            <span className="w-7 shrink-0 text-right text-sm font-medium tabular-nums">{open}</span>
          </li>
        );
      })}
    </ul>
  );
}
