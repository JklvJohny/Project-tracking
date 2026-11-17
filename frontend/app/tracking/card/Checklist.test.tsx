import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type ApiInit } from '../shared/api/client';
import { TrackingProvider } from '../shared/provider';
import { Checklist } from './Checklist';

vi.mock('../shared/api/client', async (orig) => ({ ...(await orig<object>()), api: vi.fn() }));
const apiMock = vi.mocked(api);

const items = [
  { id: 1, text: 'One', isDone: true, position: 'a' },
  { id: 2, text: 'Two', isDone: false, position: 'b' },
  { id: 3, text: 'Three', isDone: false, position: 'c' },
];
const detail = {
  id: 5, listId: 1, title: 'T', descriptionMd: '', priority: 'low', startDate: null, dueDate: null, position: 'a',
  completedAt: null, createdAt: 'x', updatedAt: 'x', archivedAt: null, assigneeIds: [], labelIds: [], checklist: items,
};

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation(async (path: string, init?: ApiInit) => {
    if (path === '/cards/5') return detail;
    if (path === '/checklist/2' && init?.method === 'PATCH') return { ...items[1], isDone: (init.json as { isDone?: boolean }).isDone };
    if (path === '/checklist/2/move') return { ...items[1], position: 'd' };
    return {};
  });
});
afterEach(cleanup);

function renderList(readOnly = false) {
  render(
    <TrackingProvider lang="en">
      <Checklist projectId={1} cardId={5} readOnly={readOnly} />
    </TrackingProvider>,
  );
}

describe('Checklist', () => {
  it('toggle updates progress text', async () => {
    renderList();
    expect(await screen.findByText('1/3 · 33%')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Two' }));
    expect(await screen.findByText('2/3 · 67%')).toBeTruthy();
    expect(apiMock).toHaveBeenCalledWith('/checklist/2', { method: 'PATCH', json: { isDone: true } });
  });

  it('Alt+ArrowDown moves the item below its next sibling', async () => {
    renderList();
    const input = await screen.findByLabelText('Item text: Two');
    fireEvent.keyDown(input, { key: 'ArrowDown', altKey: true });
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/checklist/2/move', { method: 'POST', json: { beforeId: 3, afterId: null } }),
    );
    const order = screen.getAllByRole('checkbox').map((c) => c.getAttribute('aria-label'));
    expect(order).toEqual(['One', 'Three', 'Two']);
  });

  it('read-only has no inputs or buttons', async () => {
    renderList(true);
    await screen.findByText('1/3 · 33%');
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.queryAllByRole('button').filter((b) => b.getAttribute('role') !== 'checkbox')).toHaveLength(0);
    for (const c of screen.getAllByRole('checkbox')) expect(c.hasAttribute('disabled')).toBe(true);
  });
});
