import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../shared/api/client';
import { TrackingProvider } from '../shared/provider';
import { ArchivedSheet } from './ArchivedSheet';

vi.mock('../shared/api/client', async (orig) => ({ ...(await orig<object>()), api: vi.fn() }));
const apiMock = vi.mocked(api);

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation((async (path: string) => {
    if (path === '/projects/1/archived')
      return {
        lists: [{ id: 7, boardId: 1, name: 'Old list', position: 'a', isDone: false, wipLimit: null, archivedAt: 'x' }],
        cards: [{ id: 8, listId: 1, title: 'Old card', priority: 'low', startDate: null, dueDate: null, position: 'a',
          completedAt: null, archivedAt: 'x', labelIds: [], assigneeIds: [], checklistTotal: 0, checklistDone: 0, commentCount: 0 }],
      };
    return {};
  }) as never);
});
afterEach(cleanup);

async function open(canRestoreLists: boolean) {
  render(
    <TrackingProvider lang="en">
      <ArchivedSheet projectId={1} canRestoreLists={canRestoreLists} />
    </TrackingProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Archived' }));
  await screen.findByText('Old card');
}

describe('ArchivedSheet', () => {
  it('a member restores cards but gets no list Restore (the server would answer 403)', async () => {
    await open(false);
    expect(screen.getByRole('button', { name: 'Restore Old card' })).toBeTruthy();
    expect(screen.getByText('Old list')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Restore Old list' })).toBeNull();
  });

  it('a PM can restore lists', async () => {
    await open(true);
    expect(screen.getByRole('button', { name: 'Restore Old list' })).toBeTruthy();
  });
});
