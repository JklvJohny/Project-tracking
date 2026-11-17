import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../shared/api/client';
import type { components } from '../shared/api/schema';
import { TrackingProvider } from '../shared/provider';
import { CardPanel } from './CardPanel';

vi.mock('../shared/api/client', async (orig) => ({ ...(await orig<object>()), api: vi.fn() }));
const apiMock = vi.mocked(api);

type B = components['schemas']['Board'];
const detail = {
  id: 5, listId: 1, title: 'Fix login', descriptionMd: 'desc', priority: 'low', startDate: null, dueDate: '2026-12-01',
  position: 'a', completedAt: null, createdAt: 'x', updatedAt: 'x', archivedAt: null, assigneeIds: [2], labelIds: [1],
  checklist: [{ id: 1, text: 'One', isDone: false, position: 'a' }],
};
const board = (myRole: B['myRole']): B => ({
  board: { id: 1, projectId: 1, updatedAt: 'x' },
  project: { id: 1, name: 'P' } as B['project'],
  myRole,
  lists: [],
  cards: [],
  labels: [{ id: 1, name: 'Bug', color: 'red' }],
  members: [{ userId: 2, name: 'Somchai', avatarUrl: '', role: 'member' }],
  users: [{ id: 2, name: 'Somchai', avatarUrl: '' }],
});

function renderPanel(role: B['myRole']) {
  apiMock.mockImplementation(async (path: string) => (path === '/cards/5' ? detail : board(role)));
  render(
    <TrackingProvider lang="en">
      <CardPanel projectId={1} cardId={5} onClose={() => {}} />
    </TrackingProvider>,
  );
}

beforeEach(() => apiMock.mockReset());
afterEach(cleanup);

describe('CardPanel', () => {
  it('viewer sees no inputs', async () => {
    renderPanel('viewer');
    await screen.findByText('Fix login');
    await screen.findByText('Bug');
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    // Only the sheet's own Close button is allowed.
    expect(screen.queryAllByRole('button').map((b) => b.textContent)).toEqual(['Close']);
  });

  it('member sees editable title', async () => {
    renderPanel('member');
    expect(await screen.findByLabelText('Title')).toBeTruthy();
  });
});
