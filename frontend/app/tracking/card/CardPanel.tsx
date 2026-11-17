'use client';
import { Archive, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetClose, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useArchiveCard } from '../board/mutations';
import { detailToSummary } from '../board/board-cache';
import { useBoard, useCard } from '../shared/api/queries';
import { ApiError } from '../shared/api/client';
import { errorMessage } from '../shared/errors';
import { useLang, useT } from '../shared/i18n';
import { AssigneePicker } from './AssigneePicker';
import { Checklist } from './Checklist';
import { Comments } from './Comments';
import { DescriptionField } from './DescriptionField';
import { LabelPicker } from './LabelPicker';
import { MetaFields } from './MetaFields';
import { inlineEscape } from './inline';
import { TitleField } from './TitleField';

const TEXT = {
  th: {
    panel: 'รายละเอียดการ์ด',
    close: 'ปิด',
    description: 'รายละเอียด',
    archive: 'เก็บการ์ดถาวร',
    retry: 'ลองอีกครั้ง',
    archived: 'การ์ดนี้ถูกเก็บถาวรแล้ว',
    loading: 'กำลังโหลดการ์ด',
    gone: 'ไม่พบการ์ดนี้ หรือคุณไม่มีสิทธิ์เข้าถึง',
  },
  en: {
    panel: 'Card details',
    close: 'Close',
    description: 'Description',
    archive: 'Archive card',
    retry: 'Retry',
    archived: 'This card is archived',
    loading: 'Loading card',
    gone: 'Card not found, or you do not have access to it',
  },
};

/** Hands focus back to the card that opened the panel (its link survives the close; Radix has no trigger to restore). */
function focusOpener(cardId: number) {
  document.querySelector<HTMLElement>(`a[href$="?card=${cardId}"]`)?.focus();
}

export function CardPanel({ projectId, cardId, onClose }: { projectId: number; cardId: number; onClose: () => void }) {
  const t = useT(TEXT);
  const { lang } = useLang();
  const board = useBoard(projectId);
  const card = useCard(cardId);
  const archive = useArchiveCard(projectId);
  const role = board.data?.myRole;
  const canEdit = role === 'admin' || role === 'pm' || role === 'member';
  const d = card.data;
  // A deleted card or a stale ?card id answers not_found/forbidden for good: retrying cannot help.
  const gone = card.error instanceof ApiError && (card.error.code === 'not_found' || card.error.code === 'forbidden');
  const readOnly = !canEdit || !!d?.archivedAt;

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="data-[side=right]:w-full data-[side=right]:sm:max-w-xl"
        onEscapeKeyDown={inlineEscape}
        onOpenAutoFocus={(e) => {
          // Autofocusing the title would pop the keyboard on phones; the dialog itself takes focus.
          e.preventDefault();
          (e.currentTarget as HTMLElement | null)?.focus();
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          focusOpener(cardId);
        }}
      >
        <SheetClose asChild>
          <Button variant="ghost" size="icon-sm" className="absolute top-3 right-3 z-10">
            <X aria-hidden />
            <span className="sr-only">{t.close}</span>
          </Button>
        </SheetClose>
        {/* A read-only TitleField renders the real card title as the dialog title. */}
        {!(d && board.data && readOnly) && <SheetTitle className="sr-only">{t.panel}</SheetTitle>}
        {card.isError ? (
          <div role="alert" className="m-4 flex flex-col items-start gap-3 rounded-lg border p-4">
            <p className="text-sm">{gone ? t.gone : errorMessage(card.error, lang)}</p>
            {gone ? (
              <Button variant="outline" onClick={onClose}>
                {t.close}
              </Button>
            ) : (
              <Button variant="outline" onClick={() => card.refetch()}>
                {t.retry}
              </Button>
            )}
          </div>
        ) : !d || !board.data ? (
          <div role="status" aria-label={t.loading} className="flex flex-col gap-4 p-4">
            <Skeleton className="h-9 w-2/3" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
            <TitleField projectId={projectId} cardId={cardId} value={d.title} readOnly={readOnly} />
            {d.archivedAt && <p className="text-sm text-muted-foreground">{t.archived}</p>}
            <MetaFields projectId={projectId} card={d} readOnly={readOnly} />
            <AssigneePicker
              projectId={projectId}
              card={d}
              members={board.data.members}
              users={board.data.users}
              readOnly={readOnly}
            />
            <LabelPicker
              projectId={projectId}
              card={d}
              labels={board.data.labels}
              readOnly={readOnly}
              canManage={role === 'admin' || role === 'pm'}
            />
            <section aria-label={t.description} className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">{t.description}</h3>
              <DescriptionField projectId={projectId} cardId={cardId} value={d.descriptionMd} readOnly={readOnly} />
            </section>
            <Checklist projectId={projectId} cardId={cardId} readOnly={readOnly} />
            <Comments projectId={projectId} cardId={cardId} readOnly={readOnly} />
            {!readOnly && (
              <div className="border-t pt-3">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={archive.isPending}
                  onClick={() =>
                    archive.mutate(
                      detailToSummary(d, board.data.cards.find((c) => c.id === cardId)),
                      { onSuccess: onClose },
                    )
                  }
                >
                  <Archive aria-hidden />
                  {t.archive}
                </Button>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
