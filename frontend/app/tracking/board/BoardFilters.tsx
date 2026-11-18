'use client';
import { ChevronDown, Search } from 'lucide-react';
import { useT } from '../shared/i18n';

const TEXT = {
  th: {
    group: 'ตัวกรองการ์ด',
    search: 'ค้นหาการ์ด',
    soon: 'เร็ว ๆ นี้',
    assignee: 'ผู้รับผิดชอบ',
    label: 'ป้ายกำกับ',
    priority: 'ความสำคัญ',
    due: 'กำหนดส่ง',
  },
  en: {
    group: 'Card filters',
    search: 'Search cards',
    soon: 'Coming soon',
    assignee: 'Assignee',
    label: 'Label',
    priority: 'Priority',
    due: 'Due',
  },
};

/** Placeholders only: the layout is final, the behaviour lands later. Disabled and announced as such. */
export function BoardFilters() {
  const t = useT(TEXT);
  return (
    <div role="group" aria-label={t.group} className="flex flex-wrap items-center gap-2 px-4 pb-3">
      <div className="relative min-w-40 flex-1 sm:max-w-64 sm:flex-none" title={t.soon}>
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          disabled
          aria-disabled="true"
          aria-label={t.search}
          placeholder={t.search}
          className="h-8 w-full cursor-not-allowed rounded-md border border-input bg-card pr-2 pl-8 text-sm opacity-60"
        />
      </div>
      {(['assignee', 'label', 'priority', 'due'] as const).map((k) => (
        <span key={k} title={t.soon}>
          <button
            type="button"
            disabled
            aria-disabled="true"
            aria-label={`${t[k]} (${t.soon})`}
            className="inline-flex h-8 cursor-not-allowed items-center gap-1 rounded-md border border-input bg-card px-2.5 text-sm opacity-60"
          >
            {t[k]}
            <ChevronDown className="size-3.5" aria-hidden />
          </button>
        </span>
      ))}
    </div>
  );
}
