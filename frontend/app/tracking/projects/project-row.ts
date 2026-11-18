import type { components } from '../shared/api/schema';

type S = components['schemas'];

/**
 * A row of the projects list cache. GET /projects returns the full ProjectListItem, but create, settings and
 * archive write a plain Project into the same cache, so owner, members and progress may be missing until the
 * next refetch. Every view must render a placeholder for them rather than assume they exist.
 */
export type ProjectRow = S['Project'] & Partial<Pick<S['ProjectListItem'], 'owner' | 'members' | 'cardsDone' | 'cardsTotal'>>;
