'use client';
import { Folder } from 'lucide-react';
import Link from 'next/link';
import { useT } from '../shared/i18n';
import type { ProjectRow } from '../projects/project-row';
import { routes } from '../shared/routes';
import { useCachedDocCount } from './queries';


const TEXT = {
  th: { nav: 'โฟลเดอร์โปรเจกต์', none: 'ยังไม่มีโปรเจกต์', archived: 'เก็บถาวร' },
  en: { nav: 'Project folders', none: 'No projects', archived: 'Archived' },
};

function Item({ p, current }: { p: ProjectRow; current: boolean }) {
  const t = useT(TEXT);
  // The opened folder's cache is fresher (it follows uploads and deletes); the list's count covers the rest.
  const count = useCachedDocCount(p.id) ?? p.documentCount ?? 0;
  return (
    <li>
      <Link
        href={`${routes.reports}?project=${p.id}`}
        replace
        scroll={false}
        aria-current={current ? 'true' : undefined}
        className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm transition ${
          current ? 'border-primary bg-primary/10 font-medium' : 'bg-card hover:bg-accent'
        }`}
      >
        <Folder className={`h-4 w-4 shrink-0 ${current ? 'text-primary' : 'text-muted-foreground'}`} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{p.name}</span>
        {p.archivedAt && <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{t.archived}</span>}
        {<span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">{count}</span>}
      </Link>
    </li>
  );
}

export function FolderList({ projects, current }: { projects: ProjectRow[]; current: number | null }) {
  const t = useT(TEXT);
  return (
    <nav aria-label={t.nav}>
      <ul className="space-y-1.5">
        {projects.map((p) => (
          <Item key={p.id} p={p} current={p.id === current} />
        ))}
        {projects.length === 0 && <li className="text-sm text-muted-foreground">{t.none}</li>}
      </ul>
    </nav>
  );
}
