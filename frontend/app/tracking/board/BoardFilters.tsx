'use client';
import { ChevronDown, Search, X } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { components } from '../shared/api/schema';
import { Avatar } from '../shared/Avatar';
import { priorityLabel, type Priority } from '../shared/format';
import { useLang, useT } from '../shared/i18n';
import { EMPTY_FILTER, isFiltering, type CardFilter, type DueFilter } from './card-filter';
import { LABEL_CLASS } from './CardPreview';

type S = components['schemas'];

const TEXT = {
  th: {
    group: 'ตัวกรองการ์ด',
    search: 'ค้นหาการ์ด',
    assignee: 'ผู้รับผิดชอบ',
    label: 'ป้ายกำกับ',
    priority: 'ความสำคัญ',
    due: 'กำหนดส่ง',
    nobody: 'ยังไม่มอบหมาย',
    noLabels: 'ยังไม่มีป้ายกำกับ',
    dues: { overdue: 'เลยกำหนด', week: 'ภายใน 7 วัน', none: 'ไม่มีกำหนดส่ง' } as Record<DueFilter, string>,
    picked: (n: number) => `เลือก ${n}`,
    clear: 'ล้างตัวกรอง',
    shown: (n: number, of: number) => `แสดง ${n} จาก ${of} การ์ด`,
    noDrag: 'ล้างตัวกรองก่อนจึงจะลากการ์ดได้',
  },
  en: {
    group: 'Card filters',
    search: 'Search cards',
    assignee: 'Assignee',
    label: 'Label',
    priority: 'Priority',
    due: 'Due',
    nobody: 'Unassigned',
    noLabels: 'No labels yet',
    dues: { overdue: 'Overdue', week: 'Next 7 days', none: 'No due date' } as Record<DueFilter, string>,
    picked: (n: number) => `${n} selected`,
    clear: 'Clear filters',
    shown: (n: number, of: number) => `Showing ${n} of ${of} cards`,
    noDrag: 'Clear the filters to drag cards',
  },
};

const PRIORITIES: Priority[] = ['urgent', 'high', 'medium', 'low'];
const DUES: DueFilter[] = ['overdue', 'week', 'none'];

function toggle<T>(xs: T[], x: T): T[] {
  return xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x];
}

function Menu({ label, count, children }: { label: string; count: number; children: ReactNode }) {
  const t = useT(TEXT);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={count ? `${label} (${t.picked(count)})` : label}
        className={`inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-sm hover:bg-accent data-[state=open]:bg-accent ${
          count ? 'border-primary/40 bg-primary/5 font-medium' : 'border-input bg-card'
        }`}
      >
        {label}
        {count > 0 && (
          <span aria-hidden className="rounded-full bg-primary px-1.5 text-[11px] leading-4 text-primary-foreground tabular-nums">
            {count}
          </span>
        )}
        <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-56 overflow-y-auto">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Search and filters for the board's cards. Filtering is client-side over the board snapshot already loaded, so it
 * costs no request. The board turns card dragging off while it is active (a drop among hidden cards would land
 * somewhere the user cannot see).
 */
export function BoardFilters({
  value,
  onChange,
  members,
  labels,
  shown,
  total,
}: {
  value: CardFilter;
  onChange: (f: CardFilter) => void;
  members: S['BoardMember'][];
  labels: S['BoardLabel'][];
  shown: number;
  total: number;
}) {
  const t = useT(TEXT);
  const { lang } = useLang();
  const set = (patch: Partial<CardFilter>) => onChange({ ...value, ...patch });
  // Keep the menu open while picking several.
  const keepOpen = (e: Event) => e.preventDefault();
  const active = isFiltering(value);

  return (
    <div role="group" aria-label={t.group} className="flex flex-wrap items-center gap-2 px-4 pb-3">
      <div className="relative min-w-40 flex-1 sm:max-w-64 sm:flex-none">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          aria-label={t.search}
          placeholder={t.search}
          value={value.q}
          onChange={(e) => set({ q: e.target.value })}
          onKeyDown={(e) => e.key === 'Escape' && set({ q: '' })}
          className="h-8 w-full rounded-md border border-input bg-card pr-2 pl-8 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
        />
      </div>

      <Menu label={t.assignee} count={value.assignees.length}>
        <DropdownMenuCheckboxItem
          checked={value.assignees.includes(0)}
          onCheckedChange={() => set({ assignees: toggle(value.assignees, 0) })}
          onSelect={keepOpen}
        >
          <span className="inline-flex size-6 items-center justify-center rounded-full border border-dashed text-muted-foreground" aria-hidden>
            –
          </span>
          {t.nobody}
        </DropdownMenuCheckboxItem>
        {members.length > 0 && <DropdownMenuSeparator />}
        {members.map((m) => (
          <DropdownMenuCheckboxItem
            key={m.userId}
            checked={value.assignees.includes(m.userId)}
            onCheckedChange={() => set({ assignees: toggle(value.assignees, m.userId) })}
            onSelect={keepOpen}
          >
            <Avatar user={{ id: m.userId, name: m.name, avatarUrl: m.avatarUrl }} size="sm" />
            <span className="truncate">{m.name}</span>
          </DropdownMenuCheckboxItem>
        ))}
      </Menu>

      <Menu label={t.label} count={value.labels.length}>
        {labels.length === 0 && <p className="px-2 py-1.5 text-sm text-muted-foreground">{t.noLabels}</p>}
        {labels.map((l) => (
          <DropdownMenuCheckboxItem
            key={l.id}
            checked={value.labels.includes(l.id)}
            onCheckedChange={() => set({ labels: toggle(value.labels, l.id) })}
            onSelect={keepOpen}
          >
            <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${LABEL_CLASS[l.color]}`}>{l.name}</span>
          </DropdownMenuCheckboxItem>
        ))}
      </Menu>

      <Menu label={t.priority} count={value.priorities.length}>
        {PRIORITIES.map((p) => (
          <DropdownMenuCheckboxItem
            key={p}
            checked={value.priorities.includes(p)}
            onCheckedChange={() => set({ priorities: toggle(value.priorities, p) })}
            onSelect={keepOpen}
          >
            <span aria-hidden className="size-2.5 rounded-sm" style={{ background: `var(--pb-${p})` }} />
            {priorityLabel(p, lang)}
          </DropdownMenuCheckboxItem>
        ))}
      </Menu>

      <Menu label={t.due} count={value.due.length}>
        {DUES.map((d) => (
          <DropdownMenuCheckboxItem
            key={d}
            checked={value.due.includes(d)}
            onCheckedChange={() => set({ due: toggle(value.due, d) })}
            onSelect={keepOpen}
          >
            {t.dues[d]}
          </DropdownMenuCheckboxItem>
        ))}
      </Menu>

      {active && (
        <button
            type="button"
            onClick={() => onChange(EMPTY_FILTER)}
            className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-3.5" aria-hidden />
            {t.clear}
          </button>
      )}
      {/* Always mounted so screen readers hear the count change as filters are picked. */}
      <span role="status" className="text-xs text-muted-foreground" title={active ? t.noDrag : undefined}>
        {active ? t.shown(shown, total) : ''}
      </span>
    </div>
  );
}
