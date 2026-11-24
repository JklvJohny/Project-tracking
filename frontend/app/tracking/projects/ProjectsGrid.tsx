'use client';
import Link from 'next/link';
import { routes } from '../shared/routes';
import { StatusPill } from '../shared/StatusPill';
import { ProjectArchiveButton } from './ProjectArchiveButton';
import { Members, Owner, Progress, Timeline } from './project-parts';
import type { ProjectRow } from './project-row';

export function ProjectsGrid({ projects }: { projects: ProjectRow[] }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((p) => (
        <li key={p.id} className="flex flex-col gap-3 rounded-lg border bg-card p-4 hover:bg-accent/30">
          <div className="flex items-start justify-between gap-2">
            <Link href={routes.board(p.id)} className="min-w-0 font-medium hover:underline">
              {p.name}
            </Link>
            <div className="flex shrink-0 items-center gap-1">
              <StatusPill status={p.archivedAt ? 'archived' : p.status} />
              <ProjectArchiveButton project={p} />
            </div>
          </div>
          {p.description && <p className="line-clamp-2 text-sm text-muted-foreground">{p.description}</p>}
          <div className="text-xs text-muted-foreground"><Timeline p={p} /></div>
          <Progress p={p} />
          <div className="mt-auto flex items-center justify-between gap-2 text-sm">
            <Owner p={p} />
            <Members p={p} />
          </div>
        </li>
      ))}
    </ul>
  );
}
