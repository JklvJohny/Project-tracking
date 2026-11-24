'use client';
import { Suspense } from 'react';
import { ProjectsView } from './projects/ProjectsView';

// useSearchParams needs a Suspense boundary for static builds.
export default function ProjectsPage() {
  return (
    <Suspense>
      <ProjectsView />
    </Suspense>
  );
}
