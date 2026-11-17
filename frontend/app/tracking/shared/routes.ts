// Page URLs live here so the host app can change the mount point in one place.
// Navigation uses <Link>/<a href>, never router.push.
const BASE = '/tracking';

export const routes = {
  projects: BASE,
  board: (projectId: number | string) => `${BASE}/${projectId}`,
  card: (projectId: number | string, cardId: number | string) => `${BASE}/${projectId}?card=${cardId}`,
};
