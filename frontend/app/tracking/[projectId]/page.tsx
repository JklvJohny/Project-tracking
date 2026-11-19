'use client';
import Link from 'next/link';
import { usePathname, useParams, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Settings, Upload, Users } from 'lucide-react';
import dynamic from 'next/dynamic';
import { Suspense, useCallback, useRef, useState, type CSSProperties } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { boardAccess } from '../shared/access';
import { useBoard } from '../shared/api/queries';
import { AvatarStack } from '../shared/AvatarStack';
import { useT } from '../shared/i18n';
import { StatusPill } from '../shared/StatusPill';
import { routes } from '../shared/routes';
import { ArchivedBanner } from '../board/ArchivedBanner';
import { ArchivedSheet } from '../board/ArchivedSheet';
import { BOARD_OPEN_KEY, BoardSection } from '../board/BoardSection';
import { Splitter, useSplit } from '../board/Splitter';
import { TIMELINE_OPEN_KEY, TimelineSection } from '../board/timeline/Timeline';
import { useStoredOpen } from '../board/useStoredOpen';

// Loaded on demand: keeps markdown, the pickers and the member forms out of the board's first load.
const CardPanel = dynamic(() => import('../card/CardPanel').then((m) => m.CardPanel));
const MembersDialog = dynamic(() => import('../projects/MembersDialog').then((m) => m.MembersDialog));
const ProjectSettingsDialog = dynamic(() =>
  import('../projects/ProjectSettingsDialog').then((m) => m.ProjectSettingsDialog),
);

const TEXT = {
  th: {
    projects: 'โปรเจกต์',
    invalid: 'ไม่พบโปรเจกต์',
    settings: 'ตั้งค่า',
    members: 'สมาชิก',
    back: 'กลับไปรายการโปรเจกต์',
    import: 'นำเข้า',
    soon: 'เร็ว ๆ นี้',
    team: 'สมาชิกโปรเจกต์',
  },
  en: {
    projects: 'Projects',
    invalid: 'Project not found',
    settings: 'Settings',
    members: 'Members',
    back: 'Back to projects',
    import: 'Import',
    soon: 'Coming soon',
    team: 'Project members',
  },
};

function Header({ projectId }: { projectId: number }) {
  const t = useT(TEXT);
  const board = useBoard(projectId);
  // Admin/PM keep Members (read-only) and Settings (Restore) on an archived project; everything else is gated off.
  const { manager: canManage, canEdit, canManage: canRestoreLists } = boardAccess(board.data);
  const [dialog, setDialog] = useState<'settings' | 'members' | null>(null);
  const project = board.data?.project;
  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <nav aria-label={t.projects} className="flex items-center gap-2 text-sm">
        <Link href={routes.projects} aria-label={t.back} title={t.back} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden />
        </Link>
        <Link href={routes.projects} className="text-muted-foreground hover:text-foreground">
          {t.projects}
        </Link>
        <span aria-hidden className="text-muted-foreground">
          /
        </span>
        <span className="truncate font-medium">{project?.name}</span>
      </nav>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          {project ? (
            <h1 className="truncate text-2xl font-semibold">{project.name}</h1>
          ) : (
            <Skeleton className="h-8 w-48" />
          )}
          {project && <StatusPill status={project.archivedAt ? 'archived' : project.status} />}
          {board.data && board.data.members.length > 0 && (
            <span role="group" aria-label={t.team}>
              <AvatarStack
                users={board.data.members.map((m) => ({ id: m.userId, name: m.name, avatarUrl: m.avatarUrl }))}
                max={5}
                size="md"
              />
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canManage && (
            <>
              <Button variant="outline" size="sm" onClick={() => setDialog('members')}>
                <Users aria-hidden />
                {t.members}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setDialog('settings')}>
                <Settings aria-hidden />
                {t.settings}
              </Button>
              {dialog === 'settings' && <ProjectSettingsDialog projectId={projectId} open onOpenChange={(o) => !o && setDialog(null)} />}
              {dialog === 'members' && <MembersDialog projectId={projectId} open onOpenChange={(o) => !o && setDialog(null)} />}
            </>
          )}
          <span title={t.soon}>
            <Button variant="outline" size="sm" disabled aria-disabled="true" aria-label={`${t.import} (${t.soon})`}>
              <Upload aria-hidden />
              {t.import}
            </Button>
          </span>
          {canEdit && <ArchivedSheet projectId={projectId} canRestoreLists={canRestoreLists} />}
        </div>
      </div>
    </div>
  );
}

function BoardPage() {
  const t = useT(TEXT);
  const params = useParams<{ projectId: string }>();
  const projectId = Number(params.projectId);
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const cardParam = Number(search.get('card'));
  const cardId = Number.isInteger(cardParam) && cardParam > 0 ? cardParam : undefined;
  // Closing replaces the entry (the open already pushed one, so Back also closes) and keeps other params.
  const closeCard = useCallback(() => {
    const next = new URLSearchParams(search.toString());
    next.delete('card');
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [router, pathname, search]);
  const focusChecklist = search.get('focus') === 'checklist';
  // One-shot hint from the card preview's "+": drop only `focus` so a reload or Back does not re-focus.
  const focusHandled = useCallback(() => {
    const next = new URLSearchParams(search.toString());
    next.delete('focus');
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [router, pathname, search]);
  const [boardOpen, setBoardOpen] = useStoredOpen(BOARD_OPEN_KEY, true);
  const [timelineOpen, setTimelineOpen] = useStoredOpen(TIMELINE_OPEN_KEY, false);
  const [split, setSplit] = useSplit();
  // Which section the splitter folded, if any. While set, the handle stays so it can be dragged back out.
  // Toggling a section header is an explicit choice, so it drops the handle.
  const [folded, setFolded] = useState<'board' | 'timeline' | null>(null);
  const collapse = useCallback(
    (section: 'board' | 'timeline') => {
      setFolded(section);
      if (section === 'board') setBoardOpen(false);
      else setTimelineOpen(false);
    },
    [setBoardOpen, setTimelineOpen],
  );
  const expand = useCallback(
    (section: 'board' | 'timeline', ratio: number) => {
      setSplit(ratio);
      setFolded(null);
      if (section === 'board') setBoardOpen(true);
      else setTimelineOpen(true);
    },
    [setSplit, setBoardOpen, setTimelineOpen],
  );
  const toggleBoard = useCallback(
    (o: boolean) => {
      setFolded(null);
      setBoardOpen(o);
    },
    [setBoardOpen],
  );
  const toggleTimeline = useCallback(
    (o: boolean) => {
      setFolded(null);
      setTimelineOpen(o);
    },
    [setTimelineOpen],
  );
  const stack = useRef<HTMLDivElement>(null);
  const both = boardOpen && timelineOpen;
  const foldedNow = both ? null : folded === 'board' && timelineOpen ? 'board' : folded === 'timeline' && boardOpen ? 'timeline' : null;
  const split3 = both || foldedNow !== null;
  // Board region: a share of the stack when both are open, just its header when folded, the rest when Timeline is folded.
  const boardBox = both
    ? 'sm:min-h-0 sm:shrink-0 sm:basis-[calc(var(--split)*100%)] sm:overflow-auto'
    : foldedNow === 'board'
      ? 'sm:shrink-0'
      : foldedNow === 'timeline'
        ? 'sm:min-h-0 sm:flex-1 sm:overflow-auto'
        : undefined;
  if (!Number.isInteger(projectId) || projectId <= 0) return <p className="p-6 text-sm">{t.invalid}</p>;
  return (
    <div className="flex flex-col">
      <Header projectId={projectId} />
      <ArchivedBanner projectId={projectId} />
      {/* With the splitter (both open, or one folded by it) on sm+: a fixed-height stack the handle divides.
          Below sm everything flows and scrolls with the page. */}
      <div
        ref={stack}
        style={both ? ({ '--split': split } as CSSProperties) : undefined}
        className={split3 ? 'flex flex-col sm:h-[max(32rem,calc(100dvh-12.5rem))]' : 'flex flex-col'}
      >
        <div className={boardBox}>
          <BoardSection projectId={projectId} open={boardOpen} onOpenChange={toggleBoard} />
        </div>
        {split3 && (
          <div className="max-sm:hidden">
            <Splitter
              value={split}
              collapsed={foldedNow}
              onChange={setSplit}
              onCollapse={collapse}
              onExpand={expand}
              containerRef={stack}
            />
          </div>
        )}
        <TimelineSection projectId={projectId} open={timelineOpen} onOpenChange={toggleTimeline} />
      </div>
      {cardId !== undefined && (
        <CardPanel
          key={cardId}
          projectId={projectId}
          cardId={cardId}
          onClose={closeCard}
          focusChecklist={focusChecklist}
          onFocusHandled={focusHandled}
        />
      )}
    </div>
  );
}

// useParams/useSearchParams consumers need a Suspense boundary for static builds.
export default function Page() {
  return (
    <Suspense>
      <BoardPage />
    </Suspense>
  );
}
