'use client';
import { Archive, X } from 'lucide-react';
import { LABEL_CLASS } from '../board/CardPreview';
import { Button } from '@/components/ui/button';
import { Sheet, SheetClose, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useArchiveCard } from '../board/mutations';
import { detailToSummary } from '../board/board-cache';
import { boardAccess, canTickCard } from '../shared/access';
import { useBoard, useCard, useMe } from '../shared/api/queries';
import { ApiError } from '../shared/api/client';
import { errorMessage } from '../shared/errors';
import { priorityLabel } from '../shared/format';
import { useLang, useT } from '../shared/i18n';
import { Avatar } from '../shared/Avatar';
import { AssigneePicker } from './AssigneePicker';
import { Checklist } from './Checklist';
import { Comments } from './Comments';
import { DescriptionField } from './DescriptionField';
import { LabelPicker } from './LabelPicker';
import { MetaFields } from './MetaFields';
import { StatusField } from './StatusField';
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
    location: 'ตำแหน่ง',
    details: 'ข้อมูลการ์ด',
    cardId: 'รหัสการ์ด',
    createdBy: 'สร้างโดย',
    unknown: 'ผู้ใช้ไม่ทราบชื่อ',
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
    location: 'Location',
    details: 'Card info',
    cardId: 'Card ID',
    createdBy: 'Created by',
    unknown: 'Unknown user',
    gone: 'Card not found, or you do not have access to it',
  },
};

/**
 * Hands focus back to the card that opened the panel (its link survives the close; Radix has no trigger to restore).
 * The last match wins: a list table opened over the board renders after it and holds the `&card=` link.
 * Only links on screen count: the calendar keeps its phone agenda in the DOM (display: none) after the month grid.
 */
function focusOpener(cardId: number) {
  const links = [...document.querySelectorAll<HTMLElement>(`a[href$="?card=${cardId}"], a[href$="&card=${cardId}"]`)];
  links.findLast((a) => a.getClientRects().length > 0)?.focus();
}

export function CardPanel({
  projectId,
  cardId,
  onClose,
  focusChecklist = false,
  onFocusHandled,
}: {
  projectId: number;
  cardId: number;
  onClose: () => void;
  /** From `?focus=checklist`: focus the add-item input once; the page then drops the param via onFocusHandled. */
  focusChecklist?: boolean;
  onFocusHandled?: () => void;
}) {
  const t = useT(TEXT);
  const { lang } = useLang();
  const board = useBoard(projectId);
  const card = useCard(cardId);
  const me = useMe();
  const archive = useArchiveCard(projectId);
  // An archived project is read-only for everyone, like a viewer.
  const { canEdit, canManage } = boardAccess(board.data);
  const d = card.data;
  // A deleted card or a stale ?card id answers not_found/forbidden for good: retrying cannot help.
  const gone = card.error instanceof ApiError && (card.error.code === 'not_found' || card.error.code === 'forbidden');
  const readOnly = !canEdit || !!d?.archivedAt;
  // Admin/PM tick any card; a member only a card assigned to them.
  const canTick = !readOnly && !!d && canTickCard(board.data, d.assigneeIds, me.data?.user?.id);
  // Names come from the board's user list (members and past assignees); anyone else shows as unknown.
  const creator = d && (board.data?.users.find((u) => u.id === d.createdBy) ?? { id: d.createdBy, name: `${t.unknown} #${d.createdBy}` });

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="data-[side=right]:w-full data-[side=right]:sm:max-w-[900px]"
        onEscapeKeyDown={inlineEscape}
        onOpenAutoFocus={(e) => {
          // Autofocusing the title would pop the keyboard on phones; the dialog itself takes focus.
          e.preventDefault();
          // The checklist input claims focus itself when asked; the dialog taking it here would steal it back.
          if (!focusChecklist) (e.currentTarget as HTMLElement | null)?.focus();
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          focusOpener(cardId);
        }}
      >
        {/* A read-only TitleField renders the real card title as the dialog title. */}
        {!(d && board.data && readOnly) && <SheetTitle className="sr-only">{t.panel}</SheetTitle>}
        <div className="flex items-center gap-2 border-b py-2.5 pr-3 pl-4">
          <nav aria-label={t.location} className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
            {board.data && (
              <>
                <span>{board.data.project.name}</span>
                {d && (
                  <>
                    <span aria-hidden> / </span>
                    <span className="font-medium text-foreground">
                      {board.data.lists.find((l) => l.id === d.listId)?.name}
                    </span>
                  </>
                )}
              </>
            )}
          </nav>
          {d && board.data && !readOnly && (
            <Button
              variant="ghost"
              size="sm"
              disabled={archive.isPending}
              onClick={() =>
                archive.mutate(detailToSummary(d, board.data.cards.find((c) => c.id === cardId)), { onSuccess: onClose })
              }
            >
              <Archive aria-hidden />
              {t.archive}
            </Button>
          )}
          <SheetClose asChild>
            <Button variant="ghost" size="icon-sm">
              <X aria-hidden />
              <span className="sr-only">{t.close}</span>
            </Button>
          </SheetClose>
        </div>
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
          <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[minmax(0,1fr)_17rem] md:overflow-hidden">
            <div className="flex min-w-0 flex-col gap-5 p-5 md:overflow-y-auto">
              <TitleField projectId={projectId} cardId={cardId} value={d.title} readOnly={readOnly} />
              {d.archivedAt && <p className="text-sm text-muted-foreground">{t.archived}</p>}
              <div className="flex flex-wrap items-center gap-1.5">
                {d.labelIds
                  .map((id) => board.data.labels.find((l) => l.id === id))
                  .filter((l) => !!l)
                  .map((l) => (
                    <span
                      key={l.id}
                      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${LABEL_CLASS[l.color]}`}
                    >
                      {l.name}
                    </span>
                  ))}
                <span
                  className="rounded px-1.5 py-0.5 text-[10px] leading-4 font-bold tracking-wide text-white uppercase"
                  style={{ background: `var(--pb-${d.priority})` }}
                >
                  {priorityLabel(d.priority, lang)}
                </span>
              </div>
              <section aria-label={t.description} className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">{t.description}</h3>
                <DescriptionField projectId={projectId} cardId={cardId} value={d.descriptionMd} readOnly={readOnly} />
              </section>
              <Checklist
                projectId={projectId}
                cardId={cardId}
                readOnly={readOnly}
                canTick={canTick}
                focusAdd={focusChecklist}
                onFocusHandled={onFocusHandled}
              />
              <Comments projectId={projectId} cardId={cardId} readOnly={readOnly} />
            </div>
            <aside aria-label={t.details} className="flex flex-col gap-4 border-t bg-muted/20 p-5 md:overflow-y-auto md:border-t-0 md:border-l">
              <StatusField
                projectId={projectId}
                card={d}
                lists={board.data.lists}
                cards={board.data.cards}
                readOnly={readOnly}
              />
              <AssigneePicker
                projectId={projectId}
                card={d}
                members={board.data.members}
                users={board.data.users}
                readOnly={readOnly}
              />
              <MetaFields projectId={projectId} card={d} readOnly={readOnly} />
              <LabelPicker
                projectId={projectId}
                card={d}
                labels={board.data.labels}
                readOnly={readOnly}
                canManage={canManage}
              />
              {creator && (
                <div className="flex items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
                  <span>{t.createdBy}</span>
                  <Avatar user={creator} size="xs" />
                  <span className="min-w-0 truncate text-foreground">{creator.name}</span>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {t.cardId} <code className="rounded bg-muted px-1 py-0.5 tabular-nums">{d.id}</code>
              </p>
            </aside>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
