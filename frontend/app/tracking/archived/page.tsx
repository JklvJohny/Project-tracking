'use client';
import { Suspense } from 'react';
import { ProjectsView } from '../projects/ProjectsView';

/** Archived projects, reached from the sidebar. Admin and PM restore them from here. */
export default function ArchivedProjectsPage() {
  return (
    <Suspense>
      <ProjectsView archived />
    </Suspense>
  );
}
