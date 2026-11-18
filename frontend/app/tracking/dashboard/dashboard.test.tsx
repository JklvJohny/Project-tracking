import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../shared/api/client';
import { TrackingProvider } from '../shared/provider';
import DashboardPage from './page';

vi.mock('../shared/api/client', async (orig) => ({ ...(await orig<object>()), api: vi.fn() }));
let search = '';
const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(search),
}));
const apiMock = vi.mocked(api);

const u = (id: number, name: string) => ({ id, name, avatarUrl: '' });
const project = (id: number, name: string) => ({ id, name, archivedAt: null, myRole: 'pm', members: [], owner: u(1, 'A') });
const data = {
  asOf: '2026-11-18',
  totals: { total: 12, done: 3, open: 9, inProgress: 4, notStarted: 2, overdue: 3, dueSoon: 5, unassigned: 2 },
  byProject: [
    { id: 1, name: 'Website', done: 3, inProgress: 4, notStarted: 2, overdue: 3, total: 12 },
    { id: 2, name: 'Mobile', done: 0, inProgress: 0, notStarted: 0, overdue: 0, total: 0 },
  ],
  workload: [
    { user: u(7, 'Somchai Dee'), inProgress: 2, notStarted: 1, overdue: 1, open: 4 },
    { user: u(8, 'Mali Rak'), inProgress: 0, notStarted: 0, overdue: 0, open: 0 },
  ],
  byPriority: [
    { priority: 'urgent', open: 1 },
    { priority: 'high', open: 3 },
    { priority: 'medium', open: 4 },
    { priority: 'low', open: 1 },
  ],
  deadlines: [
    { cardId: 11, projectId: 1, projectName: 'Website', listName: 'Doing', title: 'Fix login', dueDate: '2026-11-16', daysLeft: -2, assignees: [u(7, 'Somchai Dee')] },
    { cardId: 12, projectId: 1, projectName: 'Website', listName: 'To do', title: 'Write copy', dueDate: '2026-11-18', daysLeft: 0, assignees: [] },
    { cardId: 13, projectId: 2, projectName: 'Mobile', listName: 'To do', title: 'Ship build', dueDate: '2026-11-21', daysLeft: 3, assignees: [] },
  ],
};
let dash: unknown;

function setup(lang: 'en' | 'th' = 'en') {
  return render(
    <TrackingProvider lang={lang}>
      <DashboardPage />
    </TrackingProvider>,
  );
}

beforeEach(() => {
  apiMock.mockReset();
  replace.mockReset();
  search = '';
  dash = data;
  apiMock.mockImplementation((async (path: string) => {
    if (path === '/projects') return [project(1, 'Website'), project(2, 'Mobile')];
    if (path.startsWith('/dashboard')) {
      if (dash instanceof Error) throw dash;
      return dash;
    }
    throw new Error('unexpected ' + path);
  }) as never);
});
afterEach(cleanup);

const tile = (name: string) => screen.getByRole('group', { name });

describe('Dashboard', () => {
  it('renders the stat tiles with the API numbers', async () => {
    setup();
    await screen.findByText('9');
    expect(within(tile('Open tasks')).getByText('9')).toBeTruthy();
    expect(within(tile('Open tasks')).getByText('4 in progress')).toBeTruthy();
    expect(within(tile('Overdue')).getByText('3')).toBeTruthy();
    expect(within(tile('Due in 7 days')).getByText('5')).toBeTruthy();
    expect(within(tile('Unassigned')).getByText('2')).toBeTruthy();
    expect(within(tile('Completion')).getByText('25%')).toBeTruthy();
    expect(within(tile('Completion')).getByText('3 of 12 tasks done')).toBeTruthy();
    expect(screen.getByText(/as of/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /Import tasks/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('queries all projects by default and one project from ?project=', async () => {
    search = 'project=2';
    setup();
    await screen.findByText('9');
    expect(apiMock).toHaveBeenCalledWith('/dashboard?projectId=2');
    cleanup();
    apiMock.mockClear();
    search = '';
    setup();
    await screen.findByText('9');
    expect(apiMock).toHaveBeenCalledWith('/dashboard');
  });

  it('the scope select writes ?project= and "All projects" clears it', async () => {
    setup();
    const sel = (await screen.findByLabelText('Show data for')) as HTMLSelectElement;
    await waitFor(() => expect(sel.options.length).toBe(3));
    fireEvent.change(sel, { target: { value: '2' } });
    expect(replace).toHaveBeenCalledWith('/tracking/dashboard?project=2', { scroll: false });
    fireEvent.change(sel, { target: { value: 'all' } });
    expect(replace).toHaveBeenLastCalledWith('/tracking/dashboard', { scroll: false });
  });

  it('shows "No tasks" for empty projects and members', async () => {
    setup();
    await screen.findByText('9');
    expect(screen.getAllByText('No tasks')).toHaveLength(2);
  });

  it('segments carry accessible labels with counts', async () => {
    setup();
    await screen.findByText('9');
    expect(screen.getByRole('img', { name: 'Website: done 3, in progress 4, not started 2, overdue 3, total 12' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Somchai Dee: in progress 2, not started 1, overdue 1, total 4' })).toBeTruthy();
  });

  it('legends carry text and icons, not only colour', async () => {
    setup();
    await screen.findByText('9');
    const legends = screen.getAllByRole('list', { name: 'Legend' });
    expect(legends).toHaveLength(2);
    for (const word of ['Done', 'In progress', 'Not started', 'Overdue']) expect(within(legends[0]).getByText(word)).toBeTruthy();
    expect(legends[0].querySelectorAll('svg')).toHaveLength(4);
    const pri = screen.getByRole('list', { name: 'Open tasks by priority' });
    expect(within(pri).getByText('Urgent')).toBeTruthy();
    expect(pri.querySelectorAll('svg')).toHaveLength(4);
  });

  it('"View as table" shows a real table with the same numbers', async () => {
    setup();
    await screen.findByText('9');
    expect(screen.queryByRole('table')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'View as table' })[0]);
    const table = screen.getByRole('table', { name: 'Tasks by project and status' });
    const row = within(table).getByRole('row', { name: /Website/ });
    expect(within(row).getAllByRole('cell').map((c) => c.textContent)).toEqual(['3', '4', '2', '3', '12']);
    expect(screen.queryByRole('img', { name: /Website:/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'View as chart' }));
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('deadline rows show a relative label and link to the card', async () => {
    setup();
    await screen.findByText('Fix login');
    const link = screen.getByRole('link', { name: /Fix login/ });
    expect(link.getAttribute('href')).toBe('/tracking/1?card=11');
    expect(within(link).getByText('2d overdue')).toBeTruthy();
    expect(within(link).getByText('Website · Doing')).toBeTruthy();
    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByText('in 3d')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Ship build/ }).getAttribute('href')).toBe('/tracking/2?card=13');
  });

  it('shows a loading skeleton, then "No projects yet" with no projects', async () => {
    dash = { ...data, totals: { ...data.totals, total: 0, open: 0 }, byProject: [], workload: [], deadlines: [] };
    setup();
    expect(screen.getByRole('status', { name: 'Loading dashboard' })).toBeTruthy();
    expect(await screen.findByText('No projects yet')).toBeTruthy();
  });

  it('shows "No open tasks" when projects exist but nothing is open', async () => {
    dash = { ...data, totals: { ...data.totals, open: 0, done: 12 }, deadlines: [] };
    setup();
    expect(await screen.findByText('No open tasks')).toBeTruthy();
  });

  it('shows the error with Retry', async () => {
    dash = new ApiError('forbidden', 403, 'no');
    setup();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('permission');
    dash = data;
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Fix login')).toBeTruthy();
  });

  it('Thai text differs from English', async () => {
    setup('th');
    expect(await screen.findByText('เกินกำหนด 2 วัน')).toBeTruthy();
    expect(screen.getByText('งานที่ยังไม่เสร็จ')).toBeTruthy();
    expect(screen.queryByText('Open tasks')).toBeNull();
  });
});
