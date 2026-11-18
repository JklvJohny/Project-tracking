'use client';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useBoard } from '../../shared/api/queries';
import { Avatar } from '../../shared/Avatar';
import { fmtDate, todayIso } from '../../shared/format';
import { useLang, useT } from '../../shared/i18n';
import type { Lang } from '../../shared/i18n';
import {
  addDays,
  buildTimeline,
  defaultRange,
  type TimelineGroup,
  type TimelineRow,
  type TimelineStatus,
} from './timeline-model';

const OPEN_KEY = 'pt-timeline-open';
const LEFT = '10rem';

const TEXT = {
  th: {
    title: 'ไทม์ไลน์',
    subtitle: 'ใครทำงานไหนเสร็จเมื่อไหร่',
    prev: 'สัปดาห์ก่อนหน้า',
    next: 'สัปดาห์ถัดไป',
    today: 'วันนี้',
    unassigned: 'ยังไม่มอบหมาย',
    undated: 'ไม่มีวันที่',
    outside: (n: number) => `${n} การ์ดอยู่นอกช่วงนี้`,
    empty: 'ไม่มีงานที่กำหนดวันในช่วงนี้',
    tasks: (n: number) => `${n} งาน`,
    open: (title: string) => `เปิดการ์ด ${title}`,
    status: { done: 'เสร็จแล้ว', active: 'กำลังทำ', todo: 'ยังไม่เริ่ม', overdue: 'เลยกำหนด' } as Record<TimelineStatus, string>,
    todayLine: 'วันนี้',
  },
  en: {
    title: 'Timeline',
    subtitle: 'Who finishes which task, by date',
    prev: 'Previous week',
    next: 'Next week',
    today: 'Today',
    unassigned: 'Unassigned',
    undated: 'No dates',
    outside: (n: number) => `${n} card${n === 1 ? '' : 's'} outside this range`,
    empty: 'No scheduled work in this range',
    tasks: (n: number) => `${n} task${n === 1 ? '' : 's'}`,
    open: (title: string) => `Open card ${title}`,
    status: { done: 'Done', active: 'Active', todo: 'Not started', overdue: 'Overdue' } as Record<TimelineStatus, string>,
    todayLine: 'Today',
  },
};

// Module-level (slow to construct); UTC because week labels come from plain YYYY-MM-DD dates.
const WEEK_FORMAT: Record<Lang, Intl.DateTimeFormat> = {
  th: new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
  en: new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
};

function readOpen() {
  try {
    return localStorage.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

function Bar({ row, group, pathname }: { row: TimelineRow; group: TimelineGroup; pathname: string }) {
  const t = useT(TEXT);
  const { lang } = useLang();
  const who = group.assignee?.name ?? t.unassigned;
  const dates = row.from === row.to ? fmtDate(row.from, lang) : `${fmtDate(row.from, lang)} – ${fmtDate(row.to, lang)}`;
  const label = `${who}: ${row.card.title}. ${dates}. ${t.status[row.status]}`;
  const token = `var(--s-${row.status})`;
  return (
    <Link
      href={`${pathname}?card=${row.card.id}`}
      scroll={false}
      aria-label={label}
      title={`${row.card.title} · ${dates} · ${t.status[row.status]}`}
      className="absolute top-1.5 flex h-7 items-center overflow-hidden rounded-sm border-l-4 px-1.5 text-xs font-medium text-foreground shadow-sm hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
      style={{
        left: `${row.startPct}%`,
        width: `${row.widthPct}%`,
        minWidth: '1.5rem',
        borderColor: token,
        background: `color-mix(in srgb, ${token} 20%, var(--background))`,
      }}
    >
      <span className="truncate">{row.card.title}</span>
    </Link>
  );
}

function TimelineBody({ projectId }: { projectId: number }) {
  const t = useT(TEXT);
  const { lang } = useLang();
  const pathname = usePathname();
  const board = useBoard(projectId);
  const today = todayIso();
  const [range, setRange] = useState(() => defaultRange(today));
  const model = useMemo(
    () => (board.data ? buildTimeline(board.data, range, today) : null),
    [board.data, range, today],
  );
  if (!model) return <p className="px-4 py-6 text-sm text-muted-foreground">…</p>;

  const shift = (days: number) => setRange((r) => ({ ...r, start: addDays(r.start, days) }));
  const end = addDays(range.start, range.days - 1);
  const grid = {
    backgroundImage: 'linear-gradient(to right, var(--border) 1px, transparent 1px)',
    backgroundSize: `calc(100% / ${model.weeks.length}) 100%`,
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 px-4 pb-2">
        <span data-testid="timeline-range" className="text-xs font-medium tabular-nums">
          {fmtDate(range.start, lang)} – {fmtDate(end, lang)}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="ghost" size="icon" className="size-7" aria-label={t.prev} onClick={() => shift(-7)}>
            <ChevronLeft aria-hidden />
          </Button>
          <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setRange(defaultRange(today))}>
            {t.today}
          </Button>
          <Button variant="ghost" size="icon" className="size-7" aria-label={t.next} onClick={() => shift(7)}>
            <ChevronRight aria-hidden />
          </Button>
        </div>
      </div>

      {/* Own horizontal scroll with a minimum width, so a phone scrolls the chart and not the page. */}
      <div className="relative overflow-x-auto border-y bg-background">
        <div className="relative min-w-[44rem]">
          <div className="flex border-b text-xs font-medium text-muted-foreground">
            <div className="shrink-0 border-r px-3 py-1.5" style={{ width: LEFT }} />
            <div className="relative h-7 min-w-0 flex-1">
              {model.weeks.map((w) => (
                <span key={w.label} className="absolute top-1.5 pl-1.5 tabular-nums" style={{ left: `${w.leftPct}%` }}>
                  {WEEK_FORMAT[lang].format(new Date(`${w.label}T00:00:00Z`))}
                </span>
              ))}
            </div>
          </div>

          {model.todayPct !== null && (
            <div className="pointer-events-none absolute inset-y-0 right-0 z-10" style={{ left: LEFT }} aria-hidden>
              <div className="absolute inset-y-0 w-0.5 bg-(--s-active)" style={{ left: `${model.todayPct}%` }} title={t.todayLine} />
            </div>
          )}

          {model.groups.length === 0 && <p className="px-4 py-6 text-sm text-muted-foreground">{t.empty}</p>}
          {model.groups.map((g) => (
            <div key={g.assignee?.id ?? 'none'} role="group" aria-label={g.assignee?.name ?? t.unassigned}>
              <div className="flex items-center gap-2 border-b bg-muted px-3 py-1.5">
                {g.assignee ? (
                  <Avatar user={g.assignee} size="sm" />
                ) : (
                  <span aria-hidden className="size-6 rounded-full border border-dashed" />
                )}
                <span className="truncate text-sm font-semibold">{g.assignee?.name ?? t.unassigned}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">{t.tasks(g.rows.length)}</span>
              </div>
              {g.rows.map((r) => (
                <div key={r.card.id} className="flex border-b border-border/60">
                  <div className="flex shrink-0 flex-col justify-center border-r py-1 pr-2 pl-4" style={{ width: LEFT }}>
                    <span className="truncate text-sm">{r.card.title}</span>
                    <span className="truncate text-[11px] text-muted-foreground">{fmtDate(r.from, lang)}</span>
                  </div>
                  <div className="relative h-10 min-w-0 flex-1" style={grid}>
                    <Bar row={r} group={g} pathname={pathname} />
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {(model.undated.length > 0 || model.outside > 0) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 pt-2 text-xs text-muted-foreground">
          {model.undated.length > 0 && (
            <>
              <span>{t.undated}</span>
              {model.undated.map((c) => (
                <Link
                  key={c.id}
                  href={`${pathname}?card=${c.id}`}
                  scroll={false}
                  aria-label={t.open(c.title)}
                  className="max-w-48 truncate rounded border border-dashed px-1.5 py-0.5 text-foreground hover:bg-accent"
                >
                  {c.title}
                </Link>
              ))}
            </>
          )}
          {model.outside > 0 && <span className="ml-auto">{t.outside(model.outside)}</span>}
        </div>
      )}
    </div>
  );
}

/** The collapsible Timeline region below the Board. Closed on first visit, like the prototype. */
export function TimelineSection({
  projectId,
  onOpenChange,
}: {
  projectId: number;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useT(TEXT);
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(readOpen()), []);
  useEffect(() => onOpenChange?.(open), [open, onOpenChange]);
  const flip = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(OPEN_KEY, next ? '1' : '0');
    } catch {
      /* storage unavailable: the choice lasts for this visit only */
    }
  };
  return (
    <section className="flex min-h-0 flex-1 flex-col border-t bg-muted/40 pt-3">
      <div className="mx-4 mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="timeline-section-body"
          onClick={flip}
          className="flex items-center gap-1.5 rounded text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <ChevronDown className={`size-4 transition-transform ${open ? '' : '-rotate-90'}`} aria-hidden />
          {t.title}
        </button>
        <span className="hidden text-xs text-muted-foreground sm:inline">{t.subtitle}</span>
      </div>
      <div id="timeline-section-body" hidden={!open} className="min-h-0 overflow-auto">
        {open && <TimelineBody projectId={projectId} />}
      </div>
    </section>
  );
}
