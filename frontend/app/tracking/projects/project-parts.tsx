'use client';
import { Avatar } from '../shared/Avatar';
import { AvatarStack } from '../shared/AvatarStack';
import { fmtDate } from '../shared/format';
import { useLang, useT } from '../shared/i18n';
import type { ProjectRow } from './project-row';
import { PersonLink } from '../people/PersonLink';

const TEXT = {
  th: { progress: 'ความคืบหน้า' },
  en: { progress: 'Progress' },
};

export const MUTED = <span className="text-muted-foreground">–</span>;

export function Timeline({ p }: { p: ProjectRow }) {
  const { lang } = useLang();
  if (!p.startDate && !p.endDate) return MUTED;
  return (
    <span className="tabular-nums">
      {p.startDate ? fmtDate(p.startDate, lang) : '–'} – {p.endDate ? fmtDate(p.endDate, lang) : '–'}
    </span>
  );
}

export function Owner({ p }: { p: ProjectRow }) {
  if (!p.owner) return MUTED;
  return (
    <PersonLink userId={p.owner.id} className="inline-flex min-w-0 items-center gap-2">
      <Avatar user={p.owner} size="sm" />
      <span className="truncate" aria-hidden>
        {p.owner.name}
      </span>
    </PersonLink>
  );
}

export function Members({ p }: { p: ProjectRow }) {
  return p.members ? <AvatarStack users={p.members} max={4} size="sm" link /> : MUTED;
}

export function Progress({ p }: { p: ProjectRow }) {
  const t = useT(TEXT);
  if (p.cardsDone === undefined || p.cardsTotal === undefined) return MUTED;
  const pct = p.cardsTotal === 0 ? 0 : Math.round((p.cardsDone / p.cardsTotal) * 100);
  return (
    <span className="flex items-center gap-2">
      <span
        role="progressbar"
        aria-label={t.progress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="h-1.5 w-20 overflow-hidden rounded-full bg-muted"
      >
        <span className="block h-full rounded-full bg-(--s-active)" style={{ width: `${pct}%` }} />
      </span>
      <span className="text-xs tabular-nums text-muted-foreground">
        {p.cardsDone}/{p.cardsTotal}
      </span>
    </span>
  );
}
