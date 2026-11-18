import type { Lang } from './i18n';

// Module-level: constructing Intl formatters is slow and cards render hundreds of dates.
// th-TH defaults to the Buddhist calendar (2569). A plain YYYY-MM-DD parses as UTC midnight, so it is
// formatted in UTC or it would shift a day west of Greenwich; a timestamp is a moment and is shown in the
// viewer's own time zone (a comment at 01:00 Thai time is "today", not yesterday's UTC date).
const DAY = { day: 'numeric', month: 'short', year: 'numeric' } as const;
const DATE_FORMATS: Record<Lang, Intl.DateTimeFormat> = {
  th: new Intl.DateTimeFormat('th-TH', { ...DAY, timeZone: 'UTC' }),
  en: new Intl.DateTimeFormat('en-US', { ...DAY, timeZone: 'UTC' }),
};
const LOCAL_FORMATS: Record<Lang, Intl.DateTimeFormat> = {
  th: new Intl.DateTimeFormat('th-TH', DAY),
  en: new Intl.DateTimeFormat('en-US', DAY),
};
const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Formats a YYYY-MM-DD date as is, or the local calendar day of an RFC 3339 timestamp. */
export function fmtDate(iso: string, lang: Lang): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return (PLAIN_DATE.test(iso) ? DATE_FORMATS : LOCAL_FORMATS)[lang].format(d);
}

/** Today as YYYY-MM-DD in the viewer's local time zone. */
export function todayIso(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** Overdue = has a due date before today and is not completed. YYYY-MM-DD compares lexically. */
export function isOverdue(
  due: string | null | undefined,
  completedAt: string | null | undefined,
  today: string,
): boolean {
  return !!due && !completedAt && due < today;
}

export type Priority = 'low' | 'medium' | 'high' | 'urgent';

const PRIORITY_TEXT: Record<Lang, Record<Priority, string>> = {
  th: { low: 'ต่ำ', medium: 'ปานกลาง', high: 'สูง', urgent: 'เร่งด่วน' },
  en: { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' },
};

export function priorityLabel(p: Priority, lang: Lang): string {
  return PRIORITY_TEXT[lang][p];
}
