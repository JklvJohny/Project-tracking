import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../shared/api/client';
import { TrackingProvider } from '../shared/provider';
import ProjectsPage from '../page';

vi.mock('../shared/api/client', async (orig) => ({ ...(await orig<object>()), api: vi.fn() }));
let search = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search),
}));
const apiMock = vi.mocked(api);

const base = {
  status: 'active',
  description: 'Redo the site',
  startDate: '2026-01-05',
  endDate: '2026-03-20',
  archivedAt: null,
  createdAt: '2026-01-01T00:00:00Z',
};
const full = {
  ...base,
  id: 1,
  name: 'Website redesign',
  owner: { id: 7, name: 'Somchai Dee', avatarUrl: null },
  members: [
    { id: 7, name: 'Somchai Dee', avatarUrl: null },
    { id: 8, name: 'Mali Rak', avatarUrl: null },
  ],
  cardsDone: 3,
  cardsTotal: 12,
};
// What create/settings/archive write into the cache: a plain Project with no owner, members or progress.
const plain = { ...base, id: 2, name: 'Fresh project', description: '' };

function setup(rows: unknown[]) {
  apiMock.mockImplementation(async (path: string) => (path === '/me' ? { canCreateProject: true } : rows) as never);
  return render(
    <TrackingProvider lang="en">
      <ProjectsPage />
    </TrackingProvider>,
  );
}

beforeEach(() => {
  apiMock.mockReset();
  search = '';
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('Projects page', () => {
  it('archived projects sit in their own folding section under the list, not in the status tabs', async () => {
    const gone = { ...full, id: 3, name: 'Old intranet', archivedAt: '2026-10-01T00:00:00Z' };
    setup([full, gone]);
    const section = (await screen.findByRole('heading', { name: /Archived projects/ })).closest('section')!;
    expect(section.id).toBe('archived');
    expect(within(section).getByRole('link', { name: 'Old intranet' })).toBeTruthy();
    // The live list and its count leave it out.
    expect(screen.getByText('1 project')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Old intranet' })).toHaveLength(1);
    const toggle = within(section).getByRole('button', { name: /Archived projects/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    toggle.click();
    await screen.findByRole('button', { name: /Archived projects/, expanded: false });
    expect(within(section).queryByRole('link', { name: 'Old intranet' })).toBeNull();
    expect(localStorage.getItem('pt-projects-archived-open')).toBe('0');
  });

  it('no archived section when nothing is archived', async () => {
    setup([full]);
    await screen.findByRole('link', { name: 'Website redesign' });
    expect(screen.queryByRole('heading', { name: /Archived projects/ })).toBeNull();
  });

  it('table renders owner, members, timeline and progress columns', async () => {
    setup([full]);
    const table = await screen.findByRole('table');
    for (const h of ['Project', 'Owner', 'Status', 'Timeline', 'Members', 'Progress']) {
      expect(within(table).getByRole('columnheader', { name: h })).toBeTruthy();
    }
    const row = within(table).getByRole('row', { name: /Website redesign/ });
    expect(within(row).getByText('Redo the site')).toBeTruthy();
    expect(within(row).getAllByText('Somchai Dee').length).toBeGreaterThan(0);
    expect(within(row).getByText('3/12')).toBeTruthy();
    expect(within(row).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('25');
  });

  it('the table scroller is positioned, so screen-reader-only text cannot widen the page', async () => {
    setup([full]);
    const scroller = (await screen.findByRole('table')).parentElement!;
    // sr-only content is absolutely positioned; without a positioned scroller it escapes the clip and adds page-level scroll
    expect(scroller.className).toContain('relative');
    expect(scroller.className).toContain('overflow-x-auto');
  });

  it('tolerates entries without owner, members or progress', async () => {
    setup([plain]);
    const row = await screen.findByRole('row', { name: /Fresh project/ });
    expect(within(row).queryByRole('progressbar')).toBeNull();
    expect(within(row).getAllByText('–').length).toBeGreaterThan(0);
  });

  it('view=grid renders cards instead of a table, same data, tolerant', async () => {
    search = 'view=grid';
    setup([full, plain]);
    expect(await screen.findByText('Website redesign')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('3/12')).toBeTruthy();
    expect(screen.getByText('Fresh project')).toBeTruthy();
  });

  it('toggle links set ?view and keep ?status', async () => {
    search = 'status=active';
    setup([full]);
    await screen.findByRole('table');
    const grid = screen.getByRole('link', { name: 'Card view' });
    expect(grid.getAttribute('href')).toBe('/tracking?status=active&view=grid');
    expect(screen.getByRole('link', { name: 'Table view' }).getAttribute('aria-current')).toBe('true');
    expect(screen.getByRole('link', { name: /^Done/ }).getAttribute('href')).toBe('/tracking?status=done');
  });

  it('status tab keeps the chosen view', async () => {
    search = 'view=grid';
    setup([full]);
    await screen.findByText('Website redesign');
    expect(screen.getByRole('link', { name: /^Done/ }).getAttribute('href')).toBe('/tracking?status=done&view=grid');
  });
});

describe('patchProjectCaches', () => {
  it('keeps owner, members and progress when a plain Project replaces a list row', async () => {
    const { QueryClient } = await import('@tanstack/react-query');
    const { qk } = await import('../shared/api/queries');
    const { patchProjectCaches } = await import('./project-mutations');
    const qc = new QueryClient();
    qc.setQueryData(qk.projects, [full]);
    patchProjectCaches(qc, { ...base, id: 1, name: 'Renamed' } as never);
    const [row] = qc.getQueryData(qk.projects) as (typeof full)[];
    expect(row.name).toBe('Renamed');
    expect(row.owner.name).toBe('Somchai Dee');
    expect(row.cardsTotal).toBe(12);
  });
});
