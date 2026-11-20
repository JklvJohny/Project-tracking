import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, type ApiInit } from '../shared/api/client';
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

  it('a rejected move restores the order and shows the translated error', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/cards/5') return detail;
      throw new ApiError('conflict', 409, 'stale_order');
    });
    renderList();
    fireEvent.keyDown(await screen.findByLabelText('Item text: Two'), { key: 'ArrowDown', altKey: true });
    expect(await screen.findByText('Someone else changed this. Reloading')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getAllByRole('checkbox').map((c) => c.getAttribute('aria-label'))).toEqual(['One', 'Two', 'Three']),
    );
  });

  it('closing with text in the new-item input sends no POST', async () => {
    const { unmount } = render(
      <TrackingProvider lang="en">
        <Checklist projectId={1} cardId={5} readOnly={false} />
      </TrackingProvider>,
    );
    fireEvent.change(await screen.findByLabelText('Add item'), { target: { value: 'half typed' } });
    unmount();
    await new Promise((r) => setTimeout(r, 20));
    expect(apiMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  });

  it('read-only has no inputs or buttons', async () => {
    renderList(true);
    await screen.findByText('1/3 · 33%');
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.queryAllByRole('button').filter((b) => b.getAttribute('role') !== 'checkbox')).toHaveLength(0);
    for (const c of screen.getAllByRole('checkbox')) expect(c.hasAttribute('disabled')).toBe(true);
  });

  it('delete offers Undo, which re-creates the item in its old place', async () => {
    apiMock.mockImplementation(async (path: string, init?: ApiInit) => {
      if (path === '/cards/5') return detail;
      if (path === '/cards/5/checklist' && init?.method === 'POST') return { id: 9, text: 'Two', isDone: false, position: 'z' };
      if (path === '/checklist/9/move') return { id: 9, text: 'Two', isDone: false, position: 'b' };
      return {};
    });
    renderList();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete item Two' }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/checklist/2', { method: 'DELETE' }));
    await waitFor(() => expect(screen.getAllByRole('checkbox')).toHaveLength(2));
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/cards/5/checklist', { method: 'POST', json: { text: 'Two' } }),
    );
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/checklist/9/move', { method: 'POST', json: { beforeId: 1, afterId: 3 } }),
    );
    await waitFor(() =>
      expect(screen.getAllByRole('checkbox').map((c) => c.getAttribute('aria-label'))).toEqual(['One', 'Two', 'Three']),
    );
  });

  it('an inline error follows a language switch', async () => {
    const { rerender } = render(
      <TrackingProvider lang="en">
        <Checklist projectId={1} cardId={5} readOnly={false} />
      </TrackingProvider>,
    );
    fireEvent.keyDown(await screen.findByLabelText('Add item'), { key: 'Enter' });
    expect(await screen.findByText('Text is required')).toBeTruthy();
    rerender(
      <TrackingProvider lang="th">
        <Checklist projectId={1} cardId={5} readOnly={false} />
      </TrackingProvider>,
    );
    expect(await screen.findByText('ต้องกรอกข้อความ')).toBeTruthy();
  });

  it('without the right to tick, checkboxes are disabled but text stays editable', async () => {
    render(
      <TrackingProvider lang="en">
        <Checklist projectId={1} cardId={5} readOnly={false} canTick={false} />
      </TrackingProvider>,
    );
    const box = await screen.findByRole('checkbox', { name: 'Two' });
    expect(box.hasAttribute('disabled')).toBe(true);
    fireEvent.click(box);
    expect(apiMock).not.toHaveBeenCalledWith('/checklist/2', { method: 'PATCH', json: { isDone: true } });
    expect(screen.getAllByRole('textbox').length).toBeGreaterThan(0);
  });
});
