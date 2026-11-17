import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../shared/api/client';
import type { components } from '../shared/api/schema';
import { TrackingProvider } from '../shared/provider';
import { MembersDialog } from './MembersDialog';

vi.mock('../shared/api/client', async (orig) => ({ ...(await orig<object>()), api: vi.fn() }));
const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));

const apiMock = vi.mocked(api);
type S = components['schemas'];

const members: S['Member'][] = [
  { userId: 1, name: 'Ann', avatarUrl: '', role: 'pm', addedAt: '2026-11-01T00:00:00Z' },
  { userId: 2, name: 'Bob', avatarUrl: '', role: 'member', addedAt: '2026-11-01T00:00:00Z' },
];
const board = {
  board: { id: 1, projectId: 1, updatedAt: 'x' },
  project: { id: 1, name: 'P' },
  myRole: 'pm',
  lists: [],
  cards: [],
  labels: [],
  members: members.map(({ userId, name, avatarUrl, role }) => ({ userId, name, avatarUrl, role })),
  users: [],
};

let usersImpl: (q: string) => Promise<S['User'][]>;
let writeImpl: (path: string, init: { method?: string }) => Promise<unknown>;

beforeEach(() => {
  replace.mockReset();
  usersImpl = async () => [];
  writeImpl = async () => ({});
  apiMock.mockReset();
  apiMock.mockImplementation((async (path: string, init: { method?: string } = {}) => {
    if (path === '/me') return { user: { id: 1, name: 'Ann', avatarUrl: '' }, isAdmin: false, canCreateProject: true };
    if (path === '/projects/1/board') return board;
    if (path === '/projects/1/members' && !init.method) return members;
    if (path.startsWith('/users?q=')) return usersImpl(decodeURIComponent(path.slice(9)));
    return writeImpl(path, init);
  }) as never);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
});

function renderDialog() {
  return render(
    <TrackingProvider lang="en">
      <MembersDialog projectId={1} open onOpenChange={() => {}} />
    </TrackingProvider>,
  );
}

const writes = () => apiMock.mock.calls.filter(([, i]) => i && (i as { method?: string }).method);

describe('MembersDialog', () => {
  it('last PM conflict shows translated message', async () => {
    writeImpl = async () => {
      throw new ApiError('conflict', 409, 'a project must keep at least one PM');
    };
    renderDialog();
    const select = await screen.findByLabelText('Role of Ann');
    fireEvent.change(select, { target: { value: 'member' } });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('A project must keep at least one PM');
  });

  it('remove asks confirm first', async () => {
    renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Bob' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(writes()).toHaveLength(0);
    fireEvent.click(within(confirm).getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/projects/1/members/2', { method: 'DELETE' }),
    );
    await waitFor(() => expect(screen.queryByText('Bob')).toBeNull());
  });

  it('cancelling the confirm removes nobody', async () => {
    renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Bob' }));
    const confirm = await screen.findByRole('alertdialog');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(writes()).toHaveLength(0);
  });

  it('debounces search 250ms, hides current members, and ignores a stale slow response', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const resolvers: Record<string, (u: S['User'][]) => void> = {};
    usersImpl = (q) => new Promise((res) => (resolvers[q] = res));
    renderDialog();
    const box = await screen.findByLabelText('Search people');
    fireEvent.change(box, { target: { value: 'c' } });
    await act(async () => void vi.advanceTimersByTime(249));
    expect(resolvers.c).toBeUndefined();
    await act(async () => void vi.advanceTimersByTime(1));
    expect(resolvers.c).toBeDefined();
    fireEvent.change(box, { target: { value: 'ca' } });
    await act(async () => void vi.advanceTimersByTime(250));
    await act(async () => resolvers.ca([{ id: 3, name: 'Cara', avatarUrl: '' }, { id: 2, name: 'Bob', avatarUrl: '' }]));
    expect(await screen.findByRole('button', { name: 'Add Cara' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add Bob' })).toBeNull();
    await act(async () => resolvers.c([{ id: 9, name: 'Stale', avatarUrl: '' }]));
    expect(screen.queryByRole('button', { name: 'Add Stale' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add Cara' })).toBeTruthy();
  });

  it('adds a found person with the chosen role', async () => {
    usersImpl = async () => [{ id: 3, name: 'Cara', avatarUrl: '' }];
    writeImpl = async () => ({ userId: 3, name: 'Cara', avatarUrl: '', role: 'viewer', addedAt: 'x' });
    renderDialog();
    fireEvent.change(await screen.findByLabelText('Role for new member'), { target: { value: 'viewer' } });
    fireEvent.change(screen.getByLabelText('Search people'), { target: { value: 'ca' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Add Cara' }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/projects/1/members', { method: 'POST', json: { userId: 3, role: 'viewer' } }),
    );
    expect(await screen.findByText('Cara')).toBeTruthy();
  });

  it('removing yourself as a non-admin leaves to the projects page', async () => {
    members[1].role = 'pm'; // keep another PM so the server would allow it
    renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Ann' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/tracking'));
    members[1].role = 'member';
  });
});
