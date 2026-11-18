import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../shared/api/client';
import { qk } from '../shared/api/queries';
import type { components } from '../shared/api/schema';
import { useChecklist, useLabelCrud, useUpdateCard } from './mutations';

vi.mock('../shared/api/client', async (orig) => ({ ...(await orig<object>()), api: vi.fn() }));
const apiMock = vi.mocked(api);

type S = components['schemas'];
const summary: S['CardSummary'] = {
  id: 5, listId: 1, title: 'Old', priority: 'low', startDate: null, dueDate: null, position: 'a', completedAt: null,
  updatedAt: 'x', labelIds: [1], assigneeIds: [], checklistTotal: 0, checklistDone: 0, commentCount: 4, checklistPreview: [],
};
const detail: S['CardDetail'] = {
  ...summary, descriptionMd: '', createdAt: 'x', archivedAt: null, checklist: [],
};
const board: S['Board'] = {
  board: { id: 1, projectId: 1, updatedAt: 'x' },
  project: { id: 1, name: 'P' } as S['Board']['project'],
  myRole: 'pm',
  lists: [{ id: 1, boardId: 1, name: 'L', position: 'a', isDone: false, wipLimit: null, archivedAt: null }],
  cards: [summary],
  labels: [{ id: 1, name: 'Bug', color: 'red' }],
  members: [],
  users: [],
};

let qc: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
const boardCard = () => qc.getQueryData<S['Board']>(qk.board(1))!.cards[0];

beforeEach(() => {
  apiMock.mockReset();
  qc = new QueryClient();
  qc.setQueryData(qk.board(1), board);
  qc.setQueryData(qk.card(5), detail);
});

describe('card mutations', () => {
  it('update patches the detail and the board summary, keeping commentCount, without invalidating', async () => {
    apiMock.mockResolvedValue({ ...detail, title: 'New' });
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateCard(1, 5), { wrapper });
    await act(() => result.current.mutateAsync({ title: 'New' }));
    expect(qc.getQueryData<S['CardDetail']>(qk.card(5))?.title).toBe('New');
    expect(boardCard()).toMatchObject({ title: 'New', commentCount: 4 });
    expect(spy).not.toHaveBeenCalled();
  });

  it('checklist add updates board counts', async () => {
    apiMock.mockResolvedValue({ id: 9, text: 'x', isDone: false, position: 'a' });
    const { result } = renderHook(() => useChecklist(1, 5), { wrapper });
    await act(() => result.current.add.mutateAsync('x'));
    expect(boardCard()).toMatchObject({ checklistTotal: 1, checklistDone: 0 });
  });

  it('label delete strips the id from board labels and cards', async () => {
    apiMock.mockResolvedValue({});
    const { result } = renderHook(() => useLabelCrud(1), { wrapper });
    await act(() => result.current.remove.mutateAsync(1));
    const b = qc.getQueryData<S['Board']>(qk.board(1))!;
    expect(b.labels).toEqual([]);
    expect(b.cards[0].labelIds).toEqual([]);
    expect(qc.getQueryData<S['CardDetail']>(qk.card(5))?.labelIds).toEqual([]);
  });
});
