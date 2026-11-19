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
const card: B['cards'][number] = {
  id: 5, listId: 1, title: 'Fix login', priority: 'low', startDate: null, dueDate: null, position: 'a',
  completedAt: null, updatedAt: 'x', labelIds: [], assigneeIds: [], checklistTotal: 5, checklistDone: 1, commentCount: 0,
  checklistPreview: [
    { id: 11, text: 'Write spec', isDone: true },
    { id: 12, text: 'Build it', isDone: false },
    { id: 13, text: 'Ship it', isDone: false },
  ],
};
function snapshot(myRole: B['myRole'], archived = false): B {
  return {
    board: { id: 1, projectId: 1, updatedAt: 'x' },
    project: { id: 1, name: 'P', archivedAt: archived ? 'x' : null } as B['project'],
    myRole,
    lists: [{ id: 1, boardId: 1, name: 'To do', position: 'a', isDone: false, wipLimit: null, archivedAt: null }],
    cards: [card],
    labels: [],
    members: [{ userId: 2, name: 'Somchai Jai', avatarUrl: '', role: 'member' }],
    users: [{ id: 2, name: 'Somchai Jai', avatarUrl: '' }],
  };
}

let toggleFails = false;
async function renderAs(role: B['myRole'], archived = false) {
  apiMock.mockReset();
  apiMock.mockImplementation((async (path: string, init?: { method?: string }) => {
    if (path.endsWith('/board')) return snapshot(role, archived);
    if (path === '/checklist/12' && init?.method === 'PATCH') {
      if (toggleFails) throw new Error('boom');
      return { id: 12, text: 'Build it', isDone: true, position: 'b' };
    }
    if (path === '/cards/5/assignees/2')
      return { ...card, assigneeIds: [2], descriptionMd: '', createdAt: 'x', archivedAt: null, checklist: [] };
    throw new Error(`unexpected ${path}`);
  }) as never);
  render(
    <TrackingProvider lang="en">
      <Board projectId={1} />
    </TrackingProvider>,
  );
  await screen.findByRole('heading', { name: 'To do' });
}
beforeEach(() => {
  // cmdk (the picker list) observes its list size.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView = () => {};
  toggleFails = false;
});
afterEach(cleanup);

describe('CardPreview subtasks and assignees', () => {
  it('shows the count header, first items and "+N more"', async () => {
    await renderAs('member');
    expect(screen.getByText('5 SUBTASKS')).toBeTruthy();
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    expect(screen.getByText('+2 more')).toBeTruthy();
  });

  it('toggling a checkbox PATCHes the item and updates the count', async () => {
    await renderAs('pm');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Build it' }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/checklist/12', { method: 'PATCH', json: { isDone: true } }),
    );
    expect(screen.getByText('2/5')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Build it' }).getAttribute('aria-checked')).toBe('true');
  });

  it('a member not assigned to the card cannot tick its subtasks', async () => {
    await renderAs('member');
    const box = screen.getByRole('checkbox', { name: 'Build it' });
    expect(box.hasAttribute('disabled')).toBe(true);
    fireEvent.click(box);
    expect(apiMock).not.toHaveBeenCalledWith('/checklist/12', expect.anything());
  });

  it('rolls the toggle back when the request fails', async () => {
    toggleFails = true;
    await renderAs('pm');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Build it' }));
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: 'Build it' }).getAttribute('aria-checked')).toBe('false'),
    );
    expect(screen.getByText('1/5')).toBeTruthy();
  });

  it('the + subtask link opens the card on the checklist', async () => {
    await renderAs('member');
    expect(screen.getByRole('link', { name: 'Add subtask' }).getAttribute('href')).toBe(
      '/tracking/1?card=5&focus=checklist',
    );
  });

  it('+ assign opens the picker and assigns', async () => {
    await renderAs('member');
    fireEvent.click(screen.getByRole('button', { name: 'Add assignee' }));
    fireEvent.click(await screen.findByRole('option', { name: /Somchai Jai/ }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/cards/5/assignees/2', { method: 'PUT' }));
  });

  it('viewers and archived projects get no +, and checkboxes are disabled', async () => {
    await renderAs('viewer');
    expect(screen.queryByRole('button', { name: 'Add assignee' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Add subtask' })).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Build it' }).hasAttribute('disabled')).toBe(true);
    cleanup();
    await renderAs('pm', true);
    expect(screen.queryByRole('button', { name: 'Add assignee' })).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Build it' }).hasAttribute('disabled')).toBe(true);
  });
});
