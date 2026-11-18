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
import { BoardSection } from '../board/BoardSection';
import { Splitter, useSplit } from '../board/Splitter';
import { TimelineSection } from '../board/timeline/Timeline';

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
  const [boardOpen, setBoardOpen] = useState(true);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [split, setSplit] = useSplit();
  const stack = useRef<HTMLDivElement>(null);
  const both = boardOpen && timelineOpen;
  if (!Number.isInteger(projectId) || projectId <= 0) return <p className="p-6 text-sm">{t.invalid}</p>;
  return (
    <div className="flex flex-col">
      <Header projectId={projectId} />
      <ArchivedBanner projectId={projectId} />
      <BoardSection projectId={projectId} />
      {/* Task 7: the Timeline section renders here, below the board. */}
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
