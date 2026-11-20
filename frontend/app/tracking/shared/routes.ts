// Page URLs live here so the host app can change the mount point in one place.
// Navigation uses <Link>/<a href>, never router.push.
const BASE = '/tracking';

export const routes = {
  projects: BASE,
  /** The archived section under the projects list (the old `/archived` page redirects here). */
  archived: `${BASE}#archived`,
  myTasks: `${BASE}/my-tasks`,
  dashboard: `${BASE}/dashboard`,
  reports: `${BASE}/reports`,
  team: `${BASE}/team`,
  settings: `${BASE}/settings`,
  profile: `${BASE}/profile`,
  board: (projectId: number | string) => `${BASE}/${projectId}`,
  card: (projectId: number | string, cardId: number | string) => `${BASE}/${projectId}?card=${cardId}`,
};
