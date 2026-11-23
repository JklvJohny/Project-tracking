import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../shared/api/client';
import type { components } from '../shared/api/schema';
import { TrackingProvider } from '../shared/provider';
import { AssigneePicker } from '../card/AssigneePicker';
import PersonPage from './[userId]/page';

type S = components['schemas'];

vi.mock('../shared/api/client', async (orig) => ({ ...(await orig<object>()), api: vi.fn(), apiBlob: vi.fn() }));
let userId = '4';
vi.mock('next/navigation', () => ({
  useParams: () => ({ userId }),
  usePathname: () => `/tracking/people/${userId}`,
  useSearchParams: () => new URLSearchParams('month=2026-11'),
}));
const apiMock = vi.mocked(api);

let canViewPeople: boolean;
let forbidden: boolean;

const task = (cardId: number, projectId: number, title: string, startDate: string, dueDate: string): S['Task'] => ({
  cardId, projectId, projectName: projectId === 1 ? 'Alpha' : 'Beta', listName: 'To Do', title, priority: 'medium',
  startDate, dueDate, daysLeft: 3, checklistTotal: 0, checklistDone: 0, assignees: [{ id: 4, name: 'Kai W.', avatarUrl: '' }],
});

type Init = { method?: string };
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  userId = '4';
  canViewPeople = true;
  forbidden = false;
  apiMock.mockReset();
  apiMock.mockImplementation((async (path: string, init?: Init) => {
    if (path === '/me') return { user: { id: 2, name: 'Napat K.', avatarUrl: '' }, isAdmin: false, canCreateProject: true, canViewPeople };
    // The viewer is in Alpha only.
    if (path === '/projects') return [{ id: 1 }];
    if (path === '/team') return { asOf: '2026-11-20', people: [], catalog: [{ name: 'Go', categoryId: 1 }], categories: [{ id: 1, name: 'Programming' }] };
    if (path === '/people/4') {
      if (forbidden) throw new ApiError('forbidden', 403, 'forbidden');
      return {
        asOf: '2026-11-20',
        person: { userId: 4, name: 'Kai W.', avatarUrl: '', skills: ['Go', 'Docker'], open: 2, overdue: 0, dueSoon: 1 },
        projects: [
          { id: 1, name: 'Alpha', status: 'active', role: 'member', open: 1 },
          { id: 7, name: 'Beta', status: 'on_hold', role: 'pm', open: 1 },
        ],
        tasks: [task(11, 1, 'Pricing page', '2026-11-16', '2026-11-21'), task(12, 7, 'Plant HMI', '2026-11-20', '2026-11-26')],
      } satisfies S['PersonPage'];
    }
    if (path.startsWith('/cards/30/assignees/') && init?.method === 'PUT') return { ...detail, assigneeIds: [4] };
    throw new Error('unexpected ' + path);
  }) as never);
});
afterEach(cleanup);

const renderPage = () =>
  render(
    <TrackingProvider lang="en">
      <PersonPage />
    </TrackingProvider>,
  );

describe('Person page', () => {
  it('shows their workload, every project (linked only where the viewer can go), skills and schedule', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Kai W.' })).toBeTruthy();
    const projects = screen.getByRole('region', { name: /Projects/ });
    expect(within(projects).getByRole('link', { name: 'Alpha' }).getAttribute('href')).toBe('/tracking/1');
    // Beta is listed (PMs plan across the department) but the viewer is not in it: no link.
    expect(within(projects).getByText('Beta').closest('a')).toBeNull();
    expect(within(projects).getByText('PM')).toBeTruthy();
    const skills = screen.getByRole('region', { name: 'Skills' });
    expect((await within(skills).findByText('Programming')).closest('dt')?.nextElementSibling?.textContent).toBe('Go');
    // Calendar: the Alpha card opens its board; the Beta one stays on this page.
    expect((await screen.findAllByRole('link', { name: /^Pricing page\./ }))[0].getAttribute('href')).toBe('/tracking/1?card=11');
    expect((await screen.findAllByRole('link', { name: /^Plant HMI\./ }))[0].getAttribute('href')).toBe('/tracking/people/4');
  });

  it('someone who may not look says so, with a way back', async () => {
    forbidden = true;
    renderPage();
    expect((await screen.findByRole('alert')).textContent).toMatch(/Only admins and PMs/);
    expect(screen.getByRole('link', { name: 'Back to the team' }).getAttribute('href')).toBe('/tracking/team');
  });
});

const detail = {
  id: 30, listId: 1, title: 'API docs', descriptionMd: '', priority: 'medium', startDate: '2026-11-19', dueDate: '2026-11-22',
  position: 'a', completedAt: null, archivedAt: null, createdBy: 2, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z',
  assigneeIds: [] as number[], labelIds: [], checklist: [],
} as unknown as S['CardDetail'];
const members = [{ userId: 4, name: 'Kai W.', avatarUrl: '', role: 'member' }] as S['BoardMember'][];

const renderPicker = (card = detail) =>
  render(
    <TrackingProvider lang="en">
      <AssigneePicker projectId={1} card={card} members={members} users={[]} readOnly={false} />
    </TrackingProvider>,
  );

describe('Assigning with impact', () => {
  it('a PM sees how the card lands on the person before assigning', async () => {
    renderPicker();
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/me'));
    fireEvent.click(screen.getByRole('button', { name: 'Manage assignees' }));
    fireEvent.click(await screen.findByRole('option', { name: /Kai W\./ }));
    const fig = await screen.findByRole('figure', { name: 'Impact on their schedule' });
    // Both cards share days with 19-22 Nov: the most shared days first.
    expect(within(fig).getByRole('status').textContent).toBe('Overlaps 2 cards · busiest day has 3 at once');
    expect(within(fig).getByText('Pricing page')).toBeTruthy();
    expect(within(fig).getByText('Plant HMI')).toBeTruthy();
    expect(within(fig).getByLabelText('Nov 21, 2026: 3 cards (busy)')).toBeTruthy();
    // Nothing is sent until confirmed.
    expect(apiMock.mock.calls.some(([p]) => p.startsWith('/cards/'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Assign Kai W.' }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/cards/30/assignees/4', { method: 'PUT' }));
  });

  it('an assignee opens their page for a PM, your own chip opens your profile, and a member sees plain names', async () => {
    const card = { ...detail, assigneeIds: [4, 2] };
    const users = [
      { id: 4, name: 'Kai W.', avatarUrl: '' },
      { id: 2, name: 'Napat K.', avatarUrl: '' },
    ] as S['User'][];
    const view = () =>
      render(
        <TrackingProvider lang="en">
          <AssigneePicker projectId={1} card={card} members={members} users={users} readOnly={false} />
        </TrackingProvider>,
      );
    view();
    expect((await screen.findByRole('link', { name: 'Kai W.' })).getAttribute('href')).toBe('/tracking/people/4');
    expect(screen.getByRole('link', { name: 'Napat K.' }).getAttribute('href')).toBe('/tracking/profile');
    cleanup();
    canViewPeople = false;
    view();
    expect((await screen.findByRole('link', { name: 'Napat K.' })).getAttribute('href')).toBe('/tracking/profile');
    expect(screen.queryByRole('link', { name: 'Kai W.' })).toBeNull();
  });

  it('without access to people, or for a card without dates, a pick assigns at once', async () => {
    canViewPeople = false;
    renderPicker();
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/me'));
    fireEvent.click(screen.getByRole('button', { name: 'Manage assignees' }));
    fireEvent.click(await screen.findByRole('option', { name: /Kai W\./ }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/cards/30/assignees/4', { method: 'PUT' }));
    expect(screen.queryByRole('figure')).toBeNull();
    expect(apiMock.mock.calls.some(([p]) => p === '/people/4')).toBe(false);
  });
});
