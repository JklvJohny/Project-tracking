import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../shared/api/client';
import type { components } from '../shared/api/schema';
import { TrackingProvider } from '../shared/provider';
import { Board } from './Board';

vi.mock('../shared/api/client', async (orig) => ({ ...(await orig<object>()), api: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/tracking/1' }));

type B = components['schemas']['Board'];
const apiMock = vi.mocked(api);
const lst = (id: number) => ({
  id,
  boardId: 1,
  name: `L${id}`,
  position: String(id),
  isDone: false,
  wipLimit: null,
  archivedAt: null,
});
const crd = (id: number, listId: number): B['cards'][number] => ({
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
const snap = (myRole: B['myRole']): B => ({
  board: { id: 1, projectId: 1, updatedAt: 'x' },
  project: { id: 1, name: 'P' } as B['project'],
  myRole,
  lists: [lst(1), lst(2)],
  cards: [crd(10, 1), crd(11, 1), crd(12, 2)],
  labels: [],
  members: [],
  users: [],
});

async function renderAs(role: B['myRole']) {
  apiMock.mockImplementation(async (path: string) => {
    if (path.endsWith('/board')) return snap(role);
    return { ...crd(10, 1), descriptionMd: '', createdAt: 'x', archivedAt: null, checklist: [] };
  });
  render(
    <TrackingProvider lang="en">
      <Board projectId={1} />
    </TrackingProvider>,
  );
  await screen.findByText('C10');
}
const row = (title: string) => screen.getByText(title).closest('li')!;
const writes = () => apiMock.mock.calls.filter(([, init]) => init?.method === 'POST');

beforeEach(() => {
  apiMock.mockReset();
});
afterEach(cleanup);

describe('keyboard moves', () => {
  it('Alt+ArrowDown moves a card down inside its list', async () => {
    await renderAs('member');
    fireEvent.keyDown(row('C10'), { key: 'ArrowDown', altKey: true });
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual([
      '/cards/10/move',
      { method: 'POST', json: { toListId: 1, beforeId: 11, afterId: null } },
    ]);
  });

  it('Alt+ArrowRight moves a card to the top of the next list', async () => {
    await renderAs('member');
    fireEvent.keyDown(row('C11'), { key: 'ArrowRight', altKey: true });
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][1]).toMatchObject({ json: { toListId: 2, beforeId: null, afterId: 12 } });
  });

  it('announces where a keyboard move went', async () => {
    await renderAs('member');
    fireEvent.keyDown(row('C11'), { key: 'ArrowRight', altKey: true });
    expect(await screen.findByText('Card C11 moved to L2, position 1 of 2')).toBeTruthy();
  });

  it('does nothing at the edge', async () => {
    await renderAs('member');
    fireEvent.keyDown(row('C10'), { key: 'ArrowUp', altKey: true });
    fireEvent.keyDown(row('C12'), { key: 'ArrowRight', altKey: true });
    expect(writes()).toHaveLength(0);
  });

  it('viewer cannot move or drag', async () => {
    await renderAs('viewer');
    fireEvent.keyDown(row('C10'), { key: 'ArrowDown', altKey: true });
    expect(writes()).toHaveLength(0);
    expect(row('C10').getAttribute('tabindex')).toBeNull();
    expect(screen.queryByRole('button', { name: /Move list/ })).toBeNull();
  });

  it('only admin and pm get list handles; Alt+ArrowRight moves a list', async () => {
    await renderAs('pm');
    fireEvent.keyDown(screen.getByRole('button', { name: /Move list L1/ }), { key: 'ArrowRight', altKey: true });
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual(['/lists/1/move', { method: 'POST', json: { beforeId: 2, afterId: null } }]);
  });
});
