'use client';
import { AlertTriangle, Check, ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { useBoard } from '../../shared/api/queries';
import { AvatarStack } from '../../shared/AvatarStack';
import { fmtDate, todayIso } from '../../shared/format';
import { useLang, useT, type Lang } from '../../shared/i18n';
import { addDays, statusOf, type TimelineCard, type TimelineStatus } from '../timeline/timeline-model';
import { addMonths, buildMonth, parseMonth, type CalendarBar, type CalendarDay } from './calendar-model';

// Compact rows so a month shows six cards a day before folding the rest into "+n".
const LANES = 6;
const HEAD = '1.625rem'; // the day-number row
const STEP = '1.375rem'; // one lane: a 1.25rem bar and its gap

const TEXT = {
  th: {
    prev: 'เดือนก่อนหน้า',
    next: 'เดือนถัดไป',
    today: 'วันนี้',
    moreLabel: (n: number, day: string) => `อีก ${n} การ์ดในวันที่ ${day}`,
    empty: 'ไม่มีงานที่กำหนดวันในเดือนนี้',
    undated: (n: number) => `${n} การ์ดยังไม่มีวันที่`,
    status: { done: 'เสร็จแล้ว', active: 'กำลังทำ', todo: 'ยังไม่เริ่ม', overdue: 'เลยกำหนด' } as Record<TimelineStatus, string>,
    legend: 'สถานะ',
    month: 'ปฏิทินเดือน',
  },
  en: {
    prev: 'Previous month',
    next: 'Next month',
    today: 'Today',
    moreLabel: (n: number, day: string) => `${n} more card${n === 1 ? '' : 's'} on ${day}`,
    empty: 'No scheduled work this month',
    undated: (n: number) => `${n} card${n === 1 ? ' has' : 's have'} no dates`,
    status: { done: 'Done', active: 'Active', todo: 'Not started', overdue: 'Overdue' } as Record<TimelineStatus, string>,
    legend: 'Status',
    month: 'Month calendar',
  },
};

// Module-level (slow to construct); UTC because every date here is a plain YYYY-MM-DD.
const MONTH_FORMAT: Record<Lang, Intl.DateTimeFormat> = {
  th: new Intl.DateTimeFormat('th-TH', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
  en: new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
};
const WEEKDAY_FORMAT: Record<Lang, Intl.DateTimeFormat> = {
  th: new Intl.DateTimeFormat('th-TH', { weekday: 'short', timeZone: 'UTC' }),
  en: new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }),
};
const AGENDA_DAY_FORMAT: Record<Lang, Intl.DateTimeFormat> = {
  th: new Intl.DateTimeFormat('th-TH', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }),
  en: new Intl.DateTimeFormat('en-US', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }),
};
const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);
// 2026-11-16 is a Monday; the header only needs the seven weekday names.
const WEEK = Array.from({ length: 7 }, (_, i) => addDays('2026-11-16', i));

const token = (s: TimelineStatus) => `var(--s-${s})`;

/** Status is never colour alone: done and overdue also carry an icon, and every label spells the status out. */
function StatusIcon({ status }: { status: TimelineStatus }) {
  if (status === 'done') return <Check className="size-3 shrink-0" style={{ color: token(status) }} aria-hidden />;
  if (status === 'overdue') return <AlertTriangle className="size-3 shrink-0" style={{ color: token(status) }} aria-hidden />;
  return null;
}

function useHref() {
  const pathname = usePathname();
  const search = useSearchParams();
  return (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(search.toString());
    // `card` goes last so the panel can find its opener by `&card=<id>` when it closes.
    next.delete('card');
    for (const [k, v] of Object.entries(changes)) {
      next.delete(k);
      if (v !== null) next.set(k, v);
    }
    return `${pathname}?${next.toString()}`;
  };
}

function label(card: TimelineCard, from: string, to: string, status: TimelineStatus, lang: Lang, t: (typeof TEXT)['th']) {
  const dates = from === to ? fmtDate(from, lang) : `${fmtDate(from, lang)} – ${fmtDate(to, lang)}`;
  return { dates, aria: `${card.title}. ${dates}. ${t.status[status]}` };
}

function Bar({ bar, href }: { bar: CalendarBar; href: string }) {
  const t = useT(TEXT);
  const { lang } = useLang();
  const { dates, aria } = label(bar.card, bar.from, bar.to, bar.status, lang, t);
  return (
    <Link
      href={href}
      scroll={false}
      aria-label={aria}
      title={`${bar.card.title} · ${dates} · ${t.status[bar.status]}`}
      className={`absolute flex h-5 items-center gap-1 overflow-hidden px-1.5 text-[11px] leading-none font-medium text-foreground shadow-sm hover:brightness-95 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring ${
        bar.startsBefore ? 'rounded-l-none' : 'rounded-l-sm border-l-[3px]'
      } ${bar.endsAfter ? 'rounded-r-none' : 'rounded-r-sm'} ${bar.card.completedAt ? 'line-through decoration-muted-foreground/60' : ''}`}
      style={{
        left: `calc(${(bar.col / 7) * 100}% + ${bar.startsBefore ? 0 : 3}px)`,
        width: `calc(${(bar.span / 7) * 100}% - ${(bar.startsBefore ? 0 : 3) + (bar.endsAfter ? 0 : 3)}px)`,
        top: `calc(${HEAD} + ${bar.lane} * ${STEP})`,
        borderColor: token(bar.status),
        background: `color-mix(in srgb, ${token(bar.status)} 18%, var(--background))`,
      }}
    >
      {bar.startsBefore && <ChevronLeft className="-ml-1 size-3 shrink-0 text-muted-foreground" aria-hidden />}
      <StatusIcon status={bar.status} />
      <span className="truncate">{bar.card.title}</span>
    </Link>
  );
}

function DayMore({ day, href }: { day: CalendarDay; href: (id: number) => string }) {
  const t = useT(TEXT);
  const { lang } = useLang();
  const today = todayIso();
  const long = AGENDA_DAY_FORMAT[lang].format(utc(day.iso));
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t.moreLabel(day.hidden, long)}
          className="h-5 rounded px-1.5 text-[11px] font-semibold text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          +{day.hidden}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2">
        <p className="px-1.5 pb-1.5 text-sm font-semibold">{long}</p>
        <ul className="flex flex-col gap-0.5">
          {day.cards.map((c) => {
            const from = c.startDate ?? c.dueDate!;
            const to = c.dueDate ?? from;
            const status = statusOf(c, today);
            const { dates, aria } = label(c, from, to, status, lang, t);
            return (
              <li key={c.id}>
                <Link
                  href={href(c.id)}
                  scroll={false}
                  aria-label={aria}
                  className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <span aria-hidden className="h-7 w-1 shrink-0 rounded-full" style={{ background: token(status) }} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{c.title}</span>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <StatusIcon status={status} />
                      {dates} · {t.status[status]}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

export function CalendarView({ projectId }: { projectId: number }) {
  const t = useT(TEXT);
  const { lang } = useLang();
  const search = useSearchParams();
  const board = useBoard(projectId);
  const make = useHref();
  const today = todayIso();
  const month = parseMonth(search.get('month'), today);
  const model = useMemo(() => (board.data ? buildMonth(board.data.cards, month, today, LANES) : null), [board.data, month, today]);
  const users = useMemo(() => new Map(board.data?.users.map((u) => [u.id, u]) ?? []), [board.data]);
  const cardHref = (id: number) => `${make({})}&card=${id}`;
  const agendaDays = useMemo(() => {
    const byDay = new Map<string, NonNullable<typeof model>['agenda']>();
    for (const a of model?.agenda ?? []) byDay.set(a.first, [...(byDay.get(a.first) ?? []), a]);
    return [...byDay];
  }, [model]);
  const title = MONTH_FORMAT[lang].format(utc(`${month}-01`));

  return (
    <section aria-label={t.month} className="flex flex-col gap-3 px-4 pb-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 aria-live="polite" className="min-w-40 text-lg font-semibold">
          {title}
        </h2>
        <div className="flex items-center gap-1">
          <Button asChild variant="ghost" size="icon" className="size-8">
            <Link href={make({ month: addMonths(month, -1) })} scroll={false} aria-label={t.prev} title={t.prev}>
              <ChevronLeft aria-hidden />
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="h-8">
            <Link href={make({ month: null })} scroll={false}>
              {t.today}
            </Link>
          </Button>
          <Button asChild variant="ghost" size="icon" className="size-8">
            <Link href={make({ month: addMonths(month, 1) })} scroll={false} aria-label={t.next} title={t.next}>
              <ChevronRight aria-hidden />
            </Link>
          </Button>
        </div>
        <ul aria-label={t.legend} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground sm:ml-auto">
          {(['todo', 'active', 'overdue', 'done'] as const).map((s) => (
            <li key={s} className="flex items-center gap-1.5">
              <span aria-hidden className="size-2.5 rounded-sm" style={{ background: token(s) }} />
              {t.status[s]}
            </li>
          ))}
        </ul>
      </div>

      {!model ? (
        <Skeleton className="h-[36rem] w-full" />
      ) : (
        <>
          {/* Desktop and tablet: the month grid. */}
          <div className="overflow-hidden rounded-lg border bg-card max-sm:hidden">
            <div aria-hidden className="grid grid-cols-7 border-b bg-muted/50 text-xs font-medium text-muted-foreground">
              {WEEK.map((d, i) => (
                <div key={d} className={`px-2 py-1.5 ${i >= 5 ? 'text-muted-foreground/70' : ''}`}>
                  {WEEKDAY_FORMAT[lang].format(utc(d))}
                </div>
              ))}
            </div>
            {model.weeks.map((w) => (
              <div
                key={w.days[0].iso}
                className="relative border-b last:border-b-0"
                style={{ height: `calc(${HEAD} + ${LANES} * ${STEP} + 0.25rem)` }}
              >
                <div className="absolute inset-0 grid grid-cols-7">
                  {w.days.map((d, i) => (
                    <div
                      key={d.iso}
                      className={`border-r last:border-r-0 ${d.inMonth ? (i >= 5 ? 'bg-muted/25' : '') : 'bg-muted/50'}`}
                    >
                      {/* "+n" sits beside the day number so the whole cell below is lanes. */}
                      <div className="flex items-center justify-between px-1 pt-1" style={{ height: HEAD }}>
                        <span
                          className={`inline-flex size-5 items-center justify-center rounded-full text-[11px] tabular-nums ${
                            d.today
                              ? 'bg-primary font-semibold text-primary-foreground'
                              : d.inMonth
                                ? 'font-medium'
                                : 'text-muted-foreground/70'
                          }`}
                        >
                          {d.today && <span className="sr-only">{t.today} </span>}
                          {Number(d.iso.slice(8))}
                        </span>
                        {d.hidden > 0 && <DayMore day={d} href={cardHref} />}
                      </div>
                    </div>
                  ))}
                </div>
                {w.bars.map((b) => (
                  <Bar key={b.card.id} bar={b} href={cardHref(b.card.id)} />
                ))}
              </div>
            ))}
          </div>

          {/* Phone: seven columns would leave each bar a few pixels wide, so the month reads as an agenda. */}
          <div className="sm:hidden">
            {model.agenda.length === 0 && <p className="py-6 text-sm text-muted-foreground">{t.empty}</p>}
            <ol className="flex flex-col gap-3">
              {agendaDays.map(([day, items]) => (
                <li key={day}>
                  <h3 className={`mb-1 text-sm font-semibold ${day === today ? 'text-primary' : ''}`}>
                    {AGENDA_DAY_FORMAT[lang].format(utc(day))}
                    {day === today && ` · ${t.today}`}
                  </h3>
                  <ul className="flex flex-col divide-y rounded-lg border bg-card">
                    {items.map((a) => {
                      const { dates, aria } = label(a.card, a.from, a.to, a.status, lang, t);
                      const people = a.card.assigneeIds.flatMap((id) => users.get(id) ?? []);
                      return (
                        <li key={a.card.id}>
                          <Link
                            href={cardHref(a.card.id)}
                            scroll={false}
                            aria-label={aria}
                            className="flex items-center gap-2.5 px-3 py-2 hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                          >
                            <span aria-hidden className="h-8 w-1 shrink-0 rounded-full" style={{ background: token(a.status) }} />
                            <span className="flex min-w-0 flex-1 flex-col">
                              <span className="truncate text-sm font-medium">{a.card.title}</span>
                              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                <StatusIcon status={a.status} />
                                {dates} · {t.status[a.status]}
                              </span>
                            </span>
                            {people.length > 0 && <AvatarStack users={people} max={3} size="xs" />}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ol>
          </div>

          {model.agenda.length === 0 && <p className="text-sm text-muted-foreground max-sm:hidden">{t.empty}</p>}
          {model.undated.length > 0 && <p className="text-xs text-muted-foreground">{t.undated(model.undated.length)}</p>}
        </>
      )}
    </section>
  );
}
