import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../shared/api/client';
import type { components } from '../shared/api/schema';
import { TrackingProvider } from '../shared/provider';
import { ListTableDialog } from './ListTableDialog';

vi.mock('../shared/api/client', async (orig) => ({ ...(await orig<object>()), api: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/tracking/1' }));

type B = components['schemas']['Board'];
const base: B['cards'][number] = {
  id: 5, listId: 1, title: 'Fix login', priority: 'high', startDate: null, dueDate: '2000-01-02', position: 'a',
  completedAt: null, updatedAt: 'x', labelIds: [9], assigneeIds: [], checklistTotal: 4, checklistDone: 1, commentCount: 2, checklistPreview: [],
};
const snapshot: B = {
  board: { id: 1, projectId: 1, updatedAt: 'x' },
  project: { id: 1, name: 'P' } as B['project'],
  myRole: 'pm',
  lists: [
    { id: 1, boardId: 1, name: 'To do', position: 'a', isDone: false, wipLimit: null, archivedAt: null },
    { id: 2, boardId: 1, name: 'Done', position: 'b', isDone: true, wipLimit: null, archivedAt: null },
  ],
  cards: [base, { ...base, id: 6, title: 'Write docs', labelIds: [], dueDate: null }, { ...base, id: 7, listId: 2, title: 'Elsewhere' }],
  labels: [{ id: 9, name: 'Bug', color: 'red' }],
  members: [],
  users: [],
};

afterEach(cleanup);

function show(listId: number, onClose = vi.fn()) {
  vi.mocked(api).mockResolvedValue(snapshot);
  render(
    <TrackingProvider lang="en">
      <ListTableDialog projectId={1} listId={listId} onClose={onClose} />
    </TrackingProvider>,
  );
  return onClose;
}

describe('ListTableDialog', () => {
  it("shows only the list's cards, one row each, linked so the table stays open under the card", async () => {
    show(1);
    const table = await screen.findByRole('table', { name: 'List To do' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(table).queryByText('Elsewhere')).toBeNull();
    expect(screen.getByRole('link', { name: 'Open card Fix login' }).getAttribute('href')).toBe('/tracking/1?list=1&card=5');
    expect(within(rows[0]).getByText('Bug')).toBeTruthy();
    expect(within(rows[0]).getByText('1/4')).toBeTruthy();
    expect(within(rows[0]).getByText(/Overdue/)).toBeTruthy();
    expect(screen.getByText('2 cards')).toBeTruthy();
  });

  it('says so when the list is gone', async () => {
    show(99);
    expect(await screen.findByRole('dialog', { name: 'List not found' })).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('Escape closes through onClose', async () => {
    const onClose = show(1);
    const dialog = await screen.findByRole('dialog', { name: 'To do' });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
