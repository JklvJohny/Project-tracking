import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../shared/api/client';
import type { components } from '../shared/api/schema';
import { TrackingProvider } from '../shared/provider';
import { Board } from './Board';

const board: components['schemas']['Board'] = {
  board: { id: 1, projectId: 1, updatedAt: '2026-11-17T00:00:00Z' },
  project: { id: 1, name: 'P' } as components['schemas']['Board']['project'],
  myRole: 'pm',
  lists: [{ id: 1, boardId: 1, name: 'To do', position: 'a', isDone: false, wipLimit: null, archivedAt: null }],
  cards: [],
  labels: [],
  members: [],
  users: [],
};
const state = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('../shared/api/queries', async (orig) => ({ ...(await orig<object>()), useBoard: () => state.value }));
vi.mock('next/navigation', () => ({ usePathname: () => '/tracking/1' }));

afterEach(cleanup);

const renderBoard = () =>
  render(
    <TrackingProvider lang="en">
      <Board projectId={1} />
    </TrackingProvider>,
  );

describe('Board with a failed refetch', () => {
  it('keeps the board visible when data exists but the last fetch errored', () => {
    state.value = { data: board, isPending: false, isError: true, error: new ApiError('server_error', 500, 'x'), refetch: vi.fn() };
    renderBoard();
    expect(screen.getByRole('heading', { name: 'To do' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the error panel with Retry when there is no data at all', () => {
    state.value = { data: undefined, isPending: false, isError: true, error: new ApiError('server_error', 500, 'x'), refetch: vi.fn() };
    renderBoard();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});
