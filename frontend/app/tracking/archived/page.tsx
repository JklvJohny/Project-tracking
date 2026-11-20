import { redirect } from 'next/navigation';
import { routes } from '../shared/routes';

/** Archived projects now sit under the projects list; old links and bookmarks land on that section. */
export default function ArchivedProjectsPage(): never {
  redirect(routes.archived);
}
