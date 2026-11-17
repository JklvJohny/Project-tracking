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
const list = { id: 1, boardId: 1, name: 'To do', position: 'a', isDone: false, wipLimit: null, archivedAt: null };
const card: B['cards'][number] = {
  id: 5, listId: 1, title: 'Fix login', priority: 'low', startDate: null, dueDate: null, position: 'a',
  completedAt: null, updatedAt: 'x', labelIds: [], assigneeIds: [], checklistTotal: 0, checklistDone: 0, commentCount: 0,
};
const snapshot: B = {
  board: { id: 1, projectId: 1, updatedAt: 'x' },
  project: { id: 1, name: 'P' } as B['project'],
  myRole: 'pm',
  lists: [list],
  cards: [card],
  labels: [],
  members: [],
  users: [],
};
const detail = { ...card, descriptionMd: '', createdAt: 'x', archivedAt: null, checklist: [] };

const writes = () => apiMock.mock.calls.filter(([, init]) => init?.method);

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation(async (path: string) => {
    if (path.endsWith('/board')) return snapshot;
    if (path.endsWith('/archive') && path.startsWith('/cards')) return { ...detail, archivedAt: 'now' };
    if (path.endsWith('/restore')) return detail;
    if (path.endsWith('/archive')) return { ...list, archivedAt: 'now' };
    return { ...list, name: 'Renamed' };
  });
  render(
    <TrackingProvider lang="en">
      <Board projectId={1} />
    </TrackingProvider>,
  );
});
afterEach(cleanup);

async function startRename() {
  await screen.findByRole('heading', { name: 'To do' });
  const trigger = screen.getByRole('button', { name: 'Actions for list To do' });
  fireEvent.keyDown(trigger, { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }));
  return (await screen.findByLabelText('List name')) as HTMLInputElement;
}

describe('list rename', () => {
  it('Escape does not call the API, even if blur follows', async () => {
    const input = await startRename();
    fireEvent.change(input, { target: { value: 'Other' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.blur(input);
    await waitFor(() => expect(screen.queryByLabelText('List name')).toBeNull());
    expect(writes()).toHaveLength(0);
  });

  it('Enter calls the API exactly once, even if blur follows', async () => {
    const input = await startRename();
    fireEvent.change(input, { target: { value: 'Other' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][0]).toBe('/lists/1');
  });
});

describe('archive', () => {
  it('list archive asks for confirmation before calling the API', async () => {
    await screen.findByRole('heading', { name: 'To do' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Actions for list To do' }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: /Archive list/ }));
    const dialog = await screen.findByRole('alertdialog');
    expect(writes()).toHaveLength(0);
    fireEvent.click(screen.getAllByRole('button', { name: 'Archive list' }).find((b) => dialog.contains(b))!);
    await waitFor(() => expect(writes().map((c) => c[0])).toEqual(['/lists/1/archive']));
  });

  it('card archive Undo calls restore', async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'Archive card Fix login' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(writes().map((c) => c[0])).toEqual(['/cards/5/archive', '/cards/5/restore']));
  });
});
