import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type ApiInit } from '../shared/api/client';
import type { components } from '../shared/api/schema';
import { TrackingProvider } from '../shared/provider';
import { ArchivedBanner } from './ArchivedBanner';
import { Board } from './Board';

vi.mock('../shared/api/client', async (orig) => ({ ...(await orig<object>()), api: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/tracking/1' }));

type S = components['schemas'];
const apiMock = vi.mocked(api);

const project = {
  id: 1, name: 'P', description: '', ownerId: 1, status: 'active', startDate: null, endDate: null,
  archivedAt: '2026-11-17T00:00:00Z',
} satisfies S['Board']['project'];

function snapshot(myRole: S['MyRole']): S['Board'] {
  return {
    board: { id: 1, projectId: 1, updatedAt: '2026-11-17T00:00:00Z' },
    project,
    myRole,
    lists: [{ id: 1, boardId: 1, name: 'To do', position: 'a', isDone: false, wipLimit: null, archivedAt: null }],
    cards: [],
    labels: [],
    members: [],
    users: [],
  };
}

beforeEach(() => {
  apiMock.mockReset();
});
afterEach(cleanup);

async function renderAs(role: S['MyRole']) {
  apiMock.mockImplementation((async (path: string, init?: ApiInit) => {
    if (path === '/projects/1/board') return snapshot(role);
    if (path === '/projects/1/restore' && init?.method === 'POST')
      return { ...project, archivedAt: null, createdAt: 'x', updatedAt: 'x', myRole: role };
    throw new Error(`unexpected ${path}`);
  }) as never);
  render(
    <TrackingProvider lang="en">
      <ArchivedBanner projectId={1} />
      <Board projectId={1} />
    </TrackingProvider>,
  );
  await screen.findByRole('heading', { name: 'To do' });
}

describe('Archived project', () => {
  it('is read-only for a PM, with a banner that offers Restore', async () => {
    await renderAs('pm');
    expect(screen.getByText('This project is archived. It is read-only until a PM restores it.')).toBeTruthy();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Restore project']);
  });

  it('Restore makes the board editable again', async () => {
    await renderAs('pm');
    fireEvent.click(screen.getByRole('button', { name: 'Restore project' }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/projects/1/restore', { method: 'POST' }));
    expect(await screen.findByRole('button', { name: 'Add list' })).toBeTruthy();
    expect(screen.queryByText(/This project is archived/)).toBeNull();
  });

  it('a member sees the banner but no Restore and no controls', async () => {
    await renderAs('member');
    expect(screen.getByText(/This project is archived/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
