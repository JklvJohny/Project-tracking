'use client';
import { Flag } from 'lucide-react';
import { useId } from 'react';
import { fmtDate } from '../shared/format';
import { useLang, useT, type Lang } from '../shared/i18n';
import { BUSY, levelOf, OVERLOADED, type Impact, type Level, type Span } from './impact';

const SHOWN = 6;

const TEXT = {
  th: {
    title: 'ผลกระทบต่อตารางงาน',
    summary: (n: number, peak: number) =>
      n === 0 ? 'ไม่ทับกับงานอื่น' : `ทับกับ ${n} งาน · วันที่หนักสุดมี ${peak} งานพร้อมกัน`,
    thisCard: 'งานนี้',
    more: (n: number) => `และอีก ${n} งาน`,
    perDay: 'งานต่อวัน',
    shared: (n: number) => `ทับกัน ${n} วัน`,
    dueInside: 'ครบกำหนดในช่วงนี้',
    dayLoad: (d: string, n: number, l: string) => `${d}: ${n} งาน${l ? ` (${l})` : ''}`,
    levels: { free: '', ok: '', busy: 'แน่น', over: 'งานล้น' } as Record<Level, string>,
    legendShared: 'ช่วงที่ทับกัน',
    legendBusy: `${BUSY} งาน = แน่น`,
    legendOver: `${OVERLOADED}+ งาน = งานล้น`,
    basis: 'คิดจากวันที่ของการ์ดเท่านั้น การ์ดยังไม่มีการประมาณเวลา',
  },
  en: {
    title: 'Impact on their schedule',
    summary: (n: number, peak: number) =>
      n === 0 ? 'Overlaps nothing else' : `Overlaps ${n} card${n === 1 ? '' : 's'} · busiest day has ${peak} at once`,
    thisCard: 'This card',
    more: (n: number) => `and ${n} more`,
    perDay: 'Cards per day',
    shared: (n: number) => `${n} day${n === 1 ? '' : 's'} overlap`,
    dueInside: 'due in this span',
    dayLoad: (d: string, n: number, l: string) => `${d}: ${n} card${n === 1 ? '' : 's'}${l ? ` (${l})` : ''}`,
    levels: { free: '', ok: '', busy: 'busy', over: 'overloaded' } as Record<Level, string>,
    legendShared: 'overlapping days',
    legendBusy: `${BUSY} cards = busy`,
    legendOver: `${OVERLOADED}+ = overloaded`,
    basis: 'Based on card dates only; cards have no effort estimate.',
  },
};

// Level colours come from the series tokens; every cell also prints its number, so colour is never the only cue.
const LEVEL: Record<Level, string> = {
  free: 'bg-muted/40 text-muted-foreground',
  ok: 'bg-muted text-foreground',
  busy: 'bg-(--p-high)/25 text-foreground',
  over: 'bg-(--s-overdue)/30 text-foreground font-semibold',
};

const day = (iso: string, lang: Lang) => fmtDate(iso, lang);

/** Left offset and width of `span` (clipped to the window) as percentages of the drawn days. */
function place(span: Span, days: string[]) {
  const first = days[0];
  const last = days[days.length - 1];
  if (span.to < first || span.from > last) return null;
  const from = span.from < first ? 0 : days.indexOf(span.from);
  const to = span.to > last ? days.length - 1 : days.indexOf(span.to);
  return { left: `${(from / days.length) * 100}%`, width: `${((to - from + 1) / days.length) * 100}%` };
}

/**
 * The new card against the person's other open cards on one date axis: a mini Gantt of what it overlaps (the shared
 * days shaded), then how many cards they hold each day once it is added.
 */
export function ImpactView({ impact, newTitle }: { impact: Impact; newTitle: string }) {
  const t = useT(TEXT);
  const { lang } = useLang();
  const ids = useId();
  const { days, overlaps, load, card, peak } = impact;
  const cardBox = place(card, days)!;
  const shown = overlaps.slice(0, SHOWN);
  const weekend = (iso: string) => [0, 6].includes(new Date(`${iso}T00:00:00Z`).getUTCDay());
  const label = 'w-28 shrink-0 truncate pr-2 text-xs sm:w-36';

  return (
    <figure aria-labelledby={`${ids}-t`} className="flex flex-col gap-2">
      <figcaption className="flex flex-col">
        <span id={`${ids}-t`} className="text-sm font-semibold">
          {t.title}
        </span>
        <span className="text-xs text-muted-foreground" role="status">
          {t.summary(overlaps.length, peak?.after ?? 1)}
        </span>
      </figcaption>

      <div className="flex flex-col gap-1">
        {/* Day ruler: weekends shaded, the new card's days marked. */}
        <div className="flex items-end">
          <span className={label} />
          <div aria-hidden className="relative flex h-4 flex-1">
            {days.map((d) => (
              <span
                key={d}
                className={`flex-1 text-center text-[9px] tabular-nums ${d >= card.from && d <= card.to ? 'font-semibold text-foreground' : 'text-muted-foreground'} ${weekend(d) ? 'bg-muted/50' : ''}`}
              >
                {Number(d.slice(8))}
              </span>
            ))}
          </div>
        </div>

        <ul className="flex flex-col gap-1">
          <li className="flex items-center">
            <span className={`${label} font-semibold`} title={newTitle}>
              {t.thisCard}
            </span>
            <div className="relative h-5 flex-1 rounded-sm bg-muted/30">
              <span
                className="absolute inset-y-0 flex items-center overflow-hidden rounded-sm bg-primary px-1.5 text-[10px] font-medium text-primary-foreground"
                style={cardBox}
              >
                <span className="truncate">{newTitle}</span>
              </span>
              <span className="sr-only">{`${day(card.from, lang)} – ${day(card.to, lang)}`}</span>
            </div>
          </li>
          {shown.map((o) => {
            const bar = place(o.span, days);
            const hit = place(o.shared, days);
            return (
              <li key={o.task.cardId} className="flex items-center">
                <span className={label} title={`${o.task.title} · ${o.task.projectName}`}>
                  {o.task.title}
                  <span className="block truncate text-[10px] text-muted-foreground">{o.task.projectName}</span>
                </span>
                <div className="relative h-5 flex-1 rounded-sm bg-muted/30">
                  {bar && <span aria-hidden className="absolute inset-y-1 rounded-sm bg-muted-foreground/35" style={bar} />}
                  {hit && (
                    <span
                      aria-hidden
                      className="absolute inset-y-0 rounded-sm border border-(--p-high) bg-[repeating-linear-gradient(135deg,var(--p-high)_0_3px,transparent_3px_6px)] opacity-80"
                      style={hit}
                    />
                  )}
                  {o.dueInside && o.task.dueDate && (
                    <Flag
                      aria-hidden
                      className="absolute top-0.5 size-3.5 -translate-x-1/2 text-(--s-overdue)"
                      style={{ left: `${((days.indexOf(o.task.dueDate) + 0.5) / days.length) * 100}%` }}
                    />
                  )}
                  <span className="sr-only">
                    {`${day(o.span.from, lang)} – ${day(o.span.to, lang)}. ${t.shared(o.days)}${o.dueInside ? `. ${t.dueInside}` : ''}`}
                  </span>
                </div>
              </li>
            );
          })}
          {overlaps.length > SHOWN && <li className="pl-1 text-xs text-muted-foreground">{t.more(overlaps.length - SHOWN)}</li>}
        </ul>

        {/* Cards per day once this one is added; the new card's days are outlined. */}
        <div className="mt-1 flex items-center">
          <span className={`${label} font-medium`}>{t.perDay}</span>
          <ol className="flex flex-1 gap-px">
            {load.map((d) => {
              const lv = levelOf(d.after);
              const inCard = d.day >= card.from && d.day <= card.to;
              return (
                <li
                  key={d.day}
                  aria-label={t.dayLoad(day(d.day, lang), d.after, t.levels[lv])}
                  title={t.dayLoad(day(d.day, lang), d.after, t.levels[lv])}
                  className={`flex h-6 flex-1 items-center justify-center rounded-[3px] text-[10px] tabular-nums ${LEVEL[lv]} ${inCard ? 'ring-1 ring-primary ring-inset' : ''}`}
                >
                  {d.after || ''}
                </li>
              );
            })}
          </ol>
        </div>
      </div>

      <ul aria-hidden className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <li className="flex items-center gap-1">
          <span className="h-2.5 w-4 rounded-[2px] border border-(--p-high) bg-[repeating-linear-gradient(135deg,var(--p-high)_0_2px,transparent_2px_4px)]" />
          {t.legendShared}
        </li>
        <li className="flex items-center gap-1">
          <span className="size-2.5 rounded-[2px] bg-(--p-high)/40" />
          {t.legendBusy}
        </li>
        <li className="flex items-center gap-1">
          <span className="size-2.5 rounded-[2px] bg-(--s-overdue)/45" />
          {t.legendOver}
        </li>
        <li className="flex items-center gap-1">
          <Flag className="size-3 text-(--s-overdue)" />
          {t.dueInside}
        </li>
      </ul>
      <p className="text-[11px] text-muted-foreground">{t.basis}</p>
    </figure>
  );
}
