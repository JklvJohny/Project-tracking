'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { useBoard } from '../shared/api/queries';
import { useT } from '../shared/i18n';
import { routes } from '../shared/routes';
import { ArchivedSheet } from '../board/ArchivedSheet';
import { Board } from '../board/Board';

const TEXT = {
  th: { projects: 'โปรเจกต์', invalid: 'ไม่พบโปรเจกต์' },
  en: { projects: 'Projects', invalid: 'Project not found' },
};

function Header({ projectId }: { projectId: number }) {
  const t = useT(TEXT);
  const board = useBoard(projectId);
  const role = board.data?.myRole;
  return (
    <div className="flex h-14 items-center justify-between gap-3 px-4">
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
      {role && role !== 'viewer' && <ArchivedSheet projectId={projectId} />}
    </div>
  );
}

function BoardPage() {
  const t = useT(TEXT);
  const params = useParams<{ projectId: string }>();
  const projectId = Number(params.projectId);
  if (!Number.isInteger(projectId) || projectId <= 0) return <p className="p-6 text-sm">{t.invalid}</p>;
  return (
    <div className="flex flex-col">
      <Header projectId={projectId} />
      <Board projectId={projectId} />
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
