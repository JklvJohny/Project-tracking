import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../shared/api/client';
import type { components } from '../shared/api/schema';
import { TrackingProvider } from '../shared/provider';
import { CardPanel } from './CardPanel';

vi.mock('../shared/api/client', async (orig) => ({ ...(await orig<object>()), api: vi.fn() }));
const apiMock = vi.mocked(api);

type S = components['schemas'];
const detail: S['CardDetail'] = {
  id: 5, createdBy: 3, listId: 1, title: 'Fix login', descriptionMd: 'desc', priority: 'low', startDate: null, dueDate: null,
  position: 'a', completedAt: null, createdAt: 'x', updatedAt: 'x', archivedAt: null, assigneeIds: [], labelIds: [],
  checklist: [],
};
const summary = (id: number, listId: number) =>
  ({ ...detail, id, listId, title: `C${id}`, checklistTotal: 0, checklistDone: 0, checklistPreview: [], commentCount: 0 }) as unknown as S['CardSummary'];
const board: S['Board'] = {
  board: { id: 1, projectId: 1, updatedAt: 'x' },
  project: { id: 1, name: 'Website' } as S['Project'],
  myRole: 'member',
  lists: [
    { id: 1, boardId: 1, name: 'Backlog', position: 'a', isDone: false, wipLimit: null, archivedAt: null },
    { id: 2, boardId: 1, name: 'Doing', position: 'b', isDone: false, wipLimit: null, archivedAt: null },
  ],
  cards: [summary(5, 1), summary(8, 2), summary(9, 2)],
  labels: [],
  members: [],
  users: [],
};

function renderPanel(extra: { focusChecklist?: boolean; onFocusHandled?: () => void } = {}) {
  apiMock.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (path === '/cards/5/move') return { ...detail, listId: 2 };
    if (path === '/cards/5') return detail;
    if (path === '/cards/5/comments') return [];
    if (path === '/me') return { user: { id: 2, name: 'S', avatarUrl: '' }, isAdmin: false, canCreateProject: false };
    void init;
    return board;
  });
  render(
    <TrackingProvider lang="en">
      <CardPanel projectId={1} cardId={5} onClose={() => {}} {...extra} />
    </TrackingProvider>,
  );
}

beforeEach(() => {
  apiMock.mockReset();
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(cleanup);

describe('CardPanel layout', () => {
  it('shows the Project / List breadcrumb', async () => {
    renderPanel();
    const nav = await screen.findByRole('navigation', { name: 'Location' });
    await waitFor(() => expect(nav.textContent).toBe('Website / Backlog'));
  });

  it('shows who created the card, or Unknown user when the board does not know them', async () => {
    renderPanel();
    expect(await screen.findByText('Created by')).toBeTruthy();
    expect(screen.getAllByText('Unknown user #3').length).toBeGreaterThan(0);
    cleanup();
    board.users = [{ id: 3, name: 'Mali Rak', avatarUrl: '' }];
    renderPanel();
    expect(await screen.findByText('Mali Rak', { selector: 'span.truncate' })).toBeTruthy();
    board.users = [];
  });

  it('Status (list) select moves the card to the end of the chosen list', async () => {
    renderPanel();
    const trigger = await screen.findByRole('combobox', { name: 'Status (list)' });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    fireEvent.click(await screen.findByRole('option', { name: 'Doing' }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/cards/5/move', {
        method: 'POST',
        json: { toListId: 2, beforeId: 9, afterId: null },
      }),
    );
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Status (list)' }).textContent).toContain('Doing'));
    expect(screen.getByRole('navigation', { name: 'Location' }).textContent).toBe('Website / Doing');
  });

  it('focus=checklist focuses the add-item input once and reports it', async () => {
    const handled = vi.fn();
    renderPanel({ focusChecklist: true, onFocusHandled: handled });
    const input = await screen.findByLabelText('Add item');
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(handled).toHaveBeenCalledTimes(1);
  });
});
