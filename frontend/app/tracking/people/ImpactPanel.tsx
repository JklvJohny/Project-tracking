'use client';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar } from '../shared/Avatar';
import { errorMessage } from '../shared/errors';
import { useLang, useT } from '../shared/i18n';
import { routes } from '../shared/routes';
import { impactOf, type Span } from './impact';
import { ImpactView } from './ImpactView';
import { usePerson } from './queries';
import { PersonLink } from './PersonLink';

const TEXT = {
  th: {
    assign: (n: string) => `มอบหมายให้ ${n}`,
    back: 'กลับ',
    open: (n: string) => `เปิดหน้าของ ${n}`,
    loading: 'กำลังโหลดตารางงาน',
  },
  en: {
    assign: (n: string) => `Assign ${n}`,
    back: 'Back',
    open: (n: string) => `Open ${n}'s page`,
    loading: 'Loading their schedule',
  },
};

/**
 * The step between picking someone and assigning them: how this card's dates land on their schedule. Assigning
 * stays one click; a failed load does not block it.
 */
export function ImpactPanel({
  userId,
  name,
  avatarUrl,
  card,
  onAssign,
  onBack,
}: {
  userId: number;
  name: string;
  avatarUrl: string;
  card: { id: number; title: string; span: Span };
  onAssign: () => void;
  onBack: () => void;
}) {
  const t = useT(TEXT);
  const { lang } = useLang();
  const q = usePerson(userId);
  const impact = useMemo(() => (q.data ? impactOf(q.data.tasks, card.span, card.id) : null), [q.data, card.span, card.id]);

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon-sm" aria-label={t.back} title={t.back} onClick={onBack}>
          <ArrowLeft aria-hidden />
        </Button>
        {/* The same page as the "open" link beside it: a second way in for the pointer only. */}
        <PersonLink userId={userId} decorative className="flex min-w-0 flex-1 items-center gap-2">
          <Avatar user={{ id: userId, name, avatarUrl }} size="sm" />
          <span className="min-w-0 truncate text-sm font-medium">{name}</span>
        </PersonLink>
        <Link
          href={routes.person(userId)}
          className="inline-flex items-center gap-1 rounded text-xs text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          {t.open(name)}
          <ExternalLink className="size-3" aria-hidden />
        </Link>
      </div>
      {q.isPending ? (
        <div role="status" aria-label={t.loading} className="flex flex-col gap-1.5">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-5 w-full" />
          ))}
        </div>
      ) : q.isError ? (
        <p role="alert" className="text-xs text-muted-foreground">
          {errorMessage(q.error, lang)}
        </p>
      ) : (
        impact && <ImpactView impact={impact} newTitle={card.title} />
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          {t.back}
        </Button>
        <Button size="sm" onClick={onAssign} autoFocus>
          {t.assign(name)}
        </Button>
      </div>
    </div>
  );
}
