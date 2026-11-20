// Page URLs live here so the host app can change the mount point in one place.
// Navigation uses <Link>/<a href>, never router.push.
const BASE = '/tracking';

export const routes = {
  projects: BASE,
  archived: `${BASE}/archived`,
  myTasks: `${BASE}/my-tasks`,
  dashboard: `${BASE}/dashboard`,
  reports: `${BASE}/reports`,
  team: `${BASE}/team`,
  settings: `${BASE}/settings`,
  board: (projectId: number | string) => `${BASE}/${projectId}`,
  card: (projectId: number | string, cardId: number | string) => `${BASE}/${projectId}?card=${cardId}`,
};
