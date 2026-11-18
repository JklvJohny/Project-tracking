'use client';
import { Archive } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '../shared/errors';
import { useLang, useT } from '../shared/i18n';
import { useArchived, useRestoreCard, useRestoreList } from './mutations';

const TEXT = {
  th: {
    open: 'เก็บถาวร',
    title: 'รายการที่เก็บถาวร',
    desc: 'กู้คืนลิสต์หรือการ์ดกลับมาที่บอร์ด',
    lists: 'ลิสต์',
    cards: 'การ์ด',
    restore: 'กู้คืน',
    restoreItem: (n: string) => `กู้คืน ${n}`,
    none: 'ไม่มีรายการที่เก็บถาวร',
    count: (n: number) => `${n} รายการที่เก็บถาวร`,
    retry: 'ลองอีกครั้ง',
  },
  en: {
    open: 'Archived',
    title: 'Archived items',
    desc: 'Restore lists or cards back to the board.',
    lists: 'Lists',
    cards: 'Cards',
    restore: 'Restore',
    restoreItem: (n: string) => `Restore ${n}`,
    none: 'Nothing archived',
    count: (n: number) => `${n} archived`,
    retry: 'Retry',
  },
};

/** Members restore cards; restoring a list needs admin/pm (canRestoreLists), as on the server. */
export function ArchivedSheet({ projectId, canRestoreLists }: { projectId: number; canRestoreLists: boolean }) {
  const t = useT(TEXT);
  const { lang } = useLang();
  const [open, setOpen] = useState(false);
  // Fetched eagerly: the header button shows the count. The sheet shares the same cache entry.
  const archived = useArchived(projectId, true);
  const restoreList = useRestoreList(projectId);
  const restoreCard = useRestoreCard(projectId);
  const lists = archived.data?.lists ?? [];
  const cards = archived.data?.cards ?? [];
  const count = lists.length + cards.length;

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Archive aria-hidden />
        {t.open}
        {archived.data && (
          <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums" aria-label={t.count(count)}>
            {count}
          </span>
        )}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-[min(26rem,100vw)] sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{t.title}</SheetTitle>
            <SheetDescription>{t.desc}</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-5 overflow-y-auto px-4 pb-4">
            {archived.isPending && <Skeleton className="h-24 w-full" />}
            {archived.isError && (
              <div role="alert" className="flex flex-col items-start gap-2 text-sm">
                {errorMessage(archived.error, lang)}
                <Button variant="outline" size="sm" onClick={() => archived.refetch()}>
                  {t.retry}
                </Button>
              </div>
            )}
            {archived.data && lists.length === 0 && cards.length === 0 && (
              <p className="text-sm text-muted-foreground">{t.none}</p>
            )}
            {lists.length > 0 && (
              <section aria-label={t.lists}>
                <h3 className="mb-1 text-xs font-bold tracking-wide text-muted-foreground uppercase">{t.lists}</h3>
                <ul className="divide-y rounded-lg border">
                  {lists.map((l) => (
                    <li key={l.id} className="flex items-center gap-2 px-3 py-2">
                      <span className="min-w-0 flex-1 truncate text-sm">{l.name}</span>
                      {canRestoreLists && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={restoreList.isPending}
                          aria-label={t.restoreItem(l.name)}
                          onClick={() => restoreList.mutate(l.id)}
                        >
                          {t.restore}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {cards.length > 0 && (
              <section aria-label={t.cards}>
                <h3 className="mb-1 text-xs font-bold tracking-wide text-muted-foreground uppercase">{t.cards}</h3>
                <ul className="divide-y rounded-lg border">
                  {cards.map((c) => (
                    <li key={c.id} className="flex items-center gap-2 px-3 py-2">
                      <span className="min-w-0 flex-1 truncate text-sm">{c.title}</span>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={restoreCard.isPending}
                        aria-label={t.restoreItem(c.title)}
                        onClick={() => restoreCard.mutate({ card: c })}
                      >
                        {t.restore}
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
