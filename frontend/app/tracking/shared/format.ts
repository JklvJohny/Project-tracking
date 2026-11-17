import type { Lang } from './i18n';

// Module-level: constructing Intl formatters is slow and cards render hundreds of dates.
// th-TH defaults to the Buddhist calendar (2569). UTC keeps a plain date from shifting a day.
const FORMATS: Record<Lang, Intl.DateTimeFormat> = {
  th: new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }),
  en: new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }),
};

/** Formats a YYYY-MM-DD date (or an RFC 3339 timestamp, shown in UTC). */
export function fmtDate(iso: string, lang: Lang): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : FORMATS[lang].format(d);
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
