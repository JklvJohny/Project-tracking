'use client';
import Link from 'next/link';
import { usePathname, useParams, useRouter, useSearchParams } from 'next/navigation';
import { Settings, Users } from 'lucide-react';
import dynamic from 'next/dynamic';
import { Suspense, useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useBoard } from '../shared/api/queries';
import { useT } from '../shared/i18n';
import { routes } from '../shared/routes';
import { ArchivedSheet } from '../board/ArchivedSheet';
import { Board } from '../board/Board';

// Loaded on demand: keeps markdown, the pickers and the member forms out of the board's first load.
const CardPanel = dynamic(() => import('../card/CardPanel').then((m) => m.CardPanel));
const MembersDialog = dynamic(() => import('../projects/MembersDialog').then((m) => m.MembersDialog));
const ProjectSettingsDialog = dynamic(() =>
  import('../projects/ProjectSettingsDialog').then((m) => m.ProjectSettingsDialog),
);

const TEXT = {
  th: { projects: 'โปรเจกต์', invalid: 'ไม่พบโปรเจกต์', settings: 'ตั้งค่า', members: 'สมาชิก' },
  en: { projects: 'Projects', invalid: 'Project not found', settings: 'Settings', members: 'Members' },
};

function Header({ projectId }: { projectId: number }) {
  const t = useT(TEXT);
  const board = useBoard(projectId);
  const role = board.data?.myRole;
  const canManage = role === 'admin' || role === 'pm';
  const [dialog, setDialog] = useState<'settings' | 'members' | null>(null);
  return (
    <div className="flex min-h-14 flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <Link href={routes.projects} className="text-muted-foreground hover:text-foreground">
          {t.projects}
        </Link>
        <span aria-hidden className="text-muted-foreground">
          /
        </span>
        {board.data ? (
          <h1 className="truncate text-lg font-semibold">{board.data.project.name}</h1>
        ) : (
          <Skeleton className="h-6 w-40" />
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
        {role && role !== 'viewer' && <ArchivedSheet projectId={projectId} />}
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
  if (!Number.isInteger(projectId) || projectId <= 0) return <p className="p-6 text-sm">{t.invalid}</p>;
  return (
    <div className="flex flex-col">
      <Header projectId={projectId} />
      <Board projectId={projectId} />
      {cardId !== undefined && <CardPanel key={cardId} projectId={projectId} cardId={cardId} onClose={closeCard} />}
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
