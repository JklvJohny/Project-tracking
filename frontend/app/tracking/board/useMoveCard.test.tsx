import { useQueryClient } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../shared/api/client';
import { qk } from '../shared/api/queries';
import type { components } from '../shared/api/schema';
import { TrackingProvider } from '../shared/provider';
import type { BoardData } from './board-cache';
import { useMoveCard } from './useMoveCard';
import { useMoveList } from './useMoveList';

vi.mock('../shared/api/client', async (orig) => ({
  ...(await orig<object>()),
  api: vi.fn(),
}));
vi.mock('sonner', async (orig) => ({
  ...(await orig<object>()),
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}));

type S = components['schemas'];
const apiMock = vi.mocked(api);
const toastMock = vi.mocked(toast);

const lst = (id: number, isDone = false) => ({
  id,
  boardId: 1,
  name: `L${id}`,
  position: String(id),
  isDone,
  wipLimit: null,
  archivedAt: null,
});
const crd = (id: number, listId: number): S['CardSummary'] => ({
  id,
  listId,
  title: `C${id}`,
  priority: 'low',
  startDate: null,
  dueDate: null,
  position: String(id),
  completedAt: null,
  updatedAt: 'x',
  labelIds: [],
  assigneeIds: [],
  checklistTotal: 0,
  checklistDone: 0,
  commentCount: 0,
});
const board = (): BoardData => ({
  board: { id: 1, projectId: 1, updatedAt: 'x' },
  project: { id: 1, name: 'P' } as BoardData['project'],
  myRole: 'pm',
  lists: [lst(1), lst(2, true)],
  cards: [crd(10, 1), crd(11, 1), crd(12, 2)],
  labels: [],
  members: [],
  users: [],
});
const detail = (c: S['CardSummary'], over: Partial<S['CardDetail']> = {}) =>
  ({
    ...c,
    descriptionMd: '',
    createdAt: 'x',
    archivedAt: null,
    checklist: [],
    ...over,
  }) as S['CardDetail'];

const wrapper = ({ children }: { children: ReactNode }) => <TrackingProvider lang="en">{children}</TrackingProvider>;

function setup() {
  const r = renderHook(
    () => ({
      qc: useQueryClient(),
      move: useMoveCard(1),
      moveList: useMoveList(1),
    }),
    { wrapper },
  );
  r.result.current.qc.setQueryData(qk.board(1), board());
  return r;
}
const ids = (r: { result: { current: { qc: ReturnType<typeof useQueryClient> } } }) =>
  r.result.current.qc.getQueryData<BoardData>(qk.board(1))!.cards.map((c) => `${c.id}@${c.listId}`);

beforeEach(() => {
  apiMock.mockReset();
  toastMock.mockClear();
  vi.mocked(toast.error).mockClear();
});
afterEach(cleanup);

describe('useMoveCard', () => {
  it('optimistic move updates cache before server answers', async () => {
    apiMock.mockReturnValue(new Promise(() => {}));
    const r = setup();
    act(() =>
      r.result.current.move.mutate({
        cardId: 10,
        toListId: 2,
        beforeId: 12,
        afterId: null,
      }),
    );
    await waitFor(() => expect(ids(r)).toEqual(['11@1', '12@2', '10@2']));
    expect(apiMock).toHaveBeenCalledWith('/cards/10/move', {
      method: 'POST',
      json: { toListId: 2, beforeId: 12, afterId: null },
    });
    // Dropped into a done list: looks completed at once.
    const moved = r.result.current.qc.getQueryData<BoardData>(qk.board(1))!.cards.find((c) => c.id === 10)!;
    expect(moved.completedAt).not.toBeNull();
  });

  it('success replaces the card in place with the server answer', async () => {
    const r = setup();
    apiMock.mockResolvedValue(
      detail(crd(10, 2), {
        position: 'zz',
        completedAt: '2026-01-01T00:00:00Z',
      }),
    );
    await act(() =>
      r.result.current.move.mutateAsync({
        cardId: 10,
        toListId: 2,
        beforeId: 12,
      }),
    );
    const c = r.result.current.qc.getQueryData<BoardData>(qk.board(1))!.cards.find((x) => x.id === 10)!;
    expect(c.position).toBe('zz');
    expect(c.completedAt).toBe('2026-01-01T00:00:00Z');
    expect(ids(r)).toEqual(['11@1', '12@2', '10@2']);
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('server error restores previous order and shows retry toast', async () => {
    const r = setup();
    apiMock.mockRejectedValue(new ApiError('server_error', 500, 'boom'));
    act(() => r.result.current.move.mutate({ cardId: 10, toListId: 2, beforeId: 12 }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(ids(r)).toEqual(['10@1', '11@1', '12@2']);
    const [, opts] = vi.mocked(toast.error).mock.calls[0];
    expect(opts?.action).toMatchObject({ label: 'Retry' });
    apiMock.mockResolvedValue(detail(crd(10, 2)));
    act(() => (opts!.action as unknown as { onClick: () => void }).onClick());
    await waitFor(() => expect(apiMock.mock.calls.filter(([p]) => p === '/cards/10/move')).toHaveLength(2));
  });

  it('stale_order triggers board refetch', async () => {
    const r = setup();
    const fresh = { ...board(), cards: [crd(11, 1), crd(10, 1), crd(12, 2)] };
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/projects/1/board') return fresh;
      throw new ApiError('conflict', 409, 'stale_order');
    });
    act(() => r.result.current.move.mutate({ cardId: 10, toListId: 1, beforeId: 11 }));
    await waitFor(() => expect(ids(r)).toEqual(['11@1', '10@1', '12@2']));
    expect(apiMock).toHaveBeenCalledWith('/projects/1/board');
    expect(toast.error).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith(expect.stringContaining('Reloading'));
  });
});

describe('concurrent failing moves', () => {
  it('two failures in order end on the server state, not a resurrected first move', async () => {
    const r = setup();
    const rejects: Array<() => void> = [];
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/projects/1/board') return board();
      return new Promise((_, rej) => rejects.push(() => rej(new ApiError('server_error', 500, 'boom'))));
    });
    act(() => r.result.current.move.mutate({ cardId: 10, toListId: 2, beforeId: 12 }));
    await waitFor(() => expect(rejects).toHaveLength(1));
    act(() => r.result.current.move.mutate({ cardId: 11, toListId: 2, beforeId: 10 }));
    await waitFor(() => expect(rejects).toHaveLength(2));
    expect(ids(r)).toEqual(['12@2', '10@2', '11@2']);
    await act(async () => rejects[0]());
    await act(async () => rejects[1]());
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/projects/1/board'));
    await waitFor(() => expect(ids(r)).toEqual(['10@1', '11@1', '12@2']));
    expect(apiMock.mock.calls.filter(([p]) => p === '/projects/1/board')).toHaveLength(1);
  });
});

describe('useMoveList', () => {
  it('optimistic list move, rolled back on error', async () => {
    const r = setup();
    apiMock.mockRejectedValue(new ApiError('server_error', 500, 'boom'));
    act(() => r.result.current.moveList.mutate({ listId: 1, beforeId: 2 }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(r.result.current.qc.getQueryData<BoardData>(qk.board(1))!.lists.map((l) => l.id)).toEqual([1, 2]);
    expect(apiMock).toHaveBeenCalledWith('/lists/1/move', {
      method: 'POST',
      json: { beforeId: 2 },
    });
  });
});
