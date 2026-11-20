'use client';
import { ChevronDown, Circle, CircleCheck, CircleDot, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { useT } from '../shared/i18n';

const TEXT = {
  th: {
    done: 'เสร็จแล้ว',
    inProgress: 'กำลังทำ',
    notStarted: 'ยังไม่เริ่ม',
    overdue: 'เกินกำหนด',
    legend: 'คำอธิบายสี',
    noTasks: 'ไม่มีงาน',
    asTable: 'ดูเป็นตาราง',
    asChart: 'ดูเป็นกราฟ',
    name: 'ชื่อ',
    total: 'รวม',
  },
  en: {
    done: 'Done',
    inProgress: 'In progress',
    notStarted: 'Not started',
    overdue: 'Overdue',
    legend: 'Legend',
    noTasks: 'No tasks',
    asTable: 'View as table',
    asChart: 'View as chart',
    name: 'Name',
    total: 'Total',
  },
};

export type StatusKey = 'done' | 'inProgress' | 'notStarted' | 'overdue';

// Colours are the validated --s-* series tokens; the icon beside each name means colour is never the only signal.
const STATUS: Record<StatusKey, { color: string; icon: LucideIcon }> = {
  done: { color: 'var(--s-done)', icon: CircleCheck },
  inProgress: { color: 'var(--s-active)', icon: CircleDot },
  notStarted: { color: 'var(--s-todo)', icon: Circle },
  overdue: { color: 'var(--s-overdue)', icon: TriangleAlert },
};

export type BarItem = {
  id: string | number;
  name: string;
  label: ReactNode;
  counts: Partial<Record<StatusKey, number>>;
  total: number;
};

export function StackedBars({ items, keys, caption }: { items: BarItem[]; keys: StatusKey[]; caption: string }) {
  const t = useT(TEXT);
  const [table, setTable] = useState(false);
  const bodyId = useId();
  const max = Math.max(1, ...items.map((i) => i.total));

  const legend = (
    <ul aria-label={t.legend} className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {keys.map((k) => {
        const Icon = STATUS[k].icon;
        return (
          <li key={k} className="inline-flex items-center gap-1.5">
            <Icon className="h-3.5 w-3.5" style={{ color: STATUS[k].color }} aria-hidden="true" />
            {t[k]}
          </li>
        );
      })}
    </ul>
  );

  const bars = (
    <div className="space-y-2.5">
      {items.map((it) => {
        const live = keys.filter((k) => it.counts[k]);
        const parts = keys.map((k) => `${t[k].toLowerCase()} ${it.counts[k] ?? 0}`).join(', ');
        return (
          <div key={it.id} className="flex items-center gap-3">
            <div className="flex w-28 shrink-0 items-center gap-2 truncate text-sm sm:w-40">{it.label}</div>
            <div className="flex h-5 min-w-0 flex-1 items-center">
              {it.total ? (
                <div
                  role="img"
                  aria-label={`${it.name}: ${parts}, ${t.total.toLowerCase()} ${it.total}`}
                  className="flex h-full gap-[2px]"
                  style={{ width: `${(it.total / max) * 100}%` }}
                >
                  {live.map((k, i) => (
                    <div
                      key={k}
                      title={`${t[k]}: ${it.counts[k]}`}
                      className={`h-full ${i === live.length - 1 ? 'rounded-r' : ''}`}
                      style={{ flex: `${it.counts[k]} 1 0%`, background: STATUS[k].color }}
                    />
                  ))}
                </div>
              ) : (
                <span className="text-xs text-muted-foreground">{t.noTasks}</span>
              )}
            </div>
            <div className="w-7 shrink-0 text-right text-sm font-medium tabular-nums">{it.total}</div>
          </div>
        );
      })}
    </div>
  );

  const grid = (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th scope="col" className="py-1.5 pr-3 font-medium">
              {t.name}
            </th>
            {keys.map((k) => (
              <th key={k} scope="col" className="px-2 py-1.5 text-right font-medium">
                {t[k]}
              </th>
            ))}
            <th scope="col" className="px-2 py-1.5 text-right font-medium">
              {t.total}
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id} className="border-b last:border-0">
              <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                {it.name}
              </th>
              {keys.map((k) => (
                <td key={k} className="px-2 py-1.5 text-right tabular-nums">
                  {it.counts[k] ?? 0}
                </td>
              ))}
              <td className="px-2 py-1.5 text-right font-medium tabular-nums">{it.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div>
      {legend}
      <div id={bodyId}>{table ? grid : bars}</div>
      <button
        type="button"
        aria-expanded={table}
        aria-controls={bodyId}
        onClick={() => setTable((v) => !v)}
        className="mt-4 inline-flex items-center gap-1 rounded text-xs font-medium text-primary"
      >
        <ChevronDown className={`h-3 w-3 transition ${table ? 'rotate-180' : ''}`} aria-hidden="true" />
        {table ? t.asChart : t.asTable}
      </button>
    </div>
  );
}
