import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../shared/api/client';
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

/** Everything the panel fetches besides the card itself. */
function elsewhere(path: string, role: B['myRole']) {
  if (path === '/cards/5/comments') return [];
  if (path === '/me') return { user: { id: 2, name: 'Somchai', avatarUrl: '' }, isAdmin: false, canCreateProject: false };
  return board(role);
}

function renderPanel(role: B['myRole'], onClose: () => void = () => {}) {
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/cards/5') return detail;
    return elsewhere(path, role);
  });
  render(
    <TrackingProvider lang="en">
      <CardPanel projectId={1} cardId={5} onClose={onClose} />
    </TrackingProvider>,
  );
}

beforeEach(() => {
  apiMock.mockReset();
  // cmdk needs these in jsdom.
  Element.prototype.scrollIntoView = vi.fn();
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(cleanup);

describe('CardPanel', () => {
  it('viewer sees no inputs', async () => {
    renderPanel('viewer');
    await screen.findByText('Fix login');
    await screen.findAllByText('Bug');
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    // Only the sheet's own Close button is allowed.
    expect(screen.queryAllByRole('button').map((b) => b.textContent)).toEqual(['Close']);
  });

  it('a PM on an archived project gets the viewer layout (read-only)', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/cards/5') return detail;
      const b = elsewhere(path, 'pm');
      return 'project' in b ? { ...b, project: { ...b.project, archivedAt: '2026-11-17T00:00:00Z' } } : b;
    });
    render(
      <TrackingProvider lang="en">
        <CardPanel projectId={1} cardId={5} onClose={() => {}} />
      </TrackingProvider>,
    );
    await screen.findByText('Fix login');
    await screen.findAllByText('Bug');
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.queryAllByRole('button').map((b) => b.textContent)).toEqual(['Close']);
  });

  it('member sees editable title', async () => {
    renderPanel('member');
    expect(await screen.findByLabelText('Title')).toBeTruthy();
  });

  it('Escape in a dirty title cancels the edit first and closes on the next press', async () => {
    const onClose = vi.fn();
    renderPanel('member', onClose);
    const input = (await screen.findByLabelText('Title')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Changed' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(input.value).toBe('Fix login');
    expect(apiMock.mock.calls.filter(([, init]) => init?.method)).toHaveLength(0);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a missing card shows a translated message with no Retry', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/cards/5') throw new ApiError('not_found', 404, 'not found');
      return elsewhere(path, 'pm');
    });
    render(
      <TrackingProvider lang="en">
        <CardPanel projectId={1} cardId={5} onClose={() => {}} />
      </TrackingProvider>,
    );
    expect(await screen.findByText('Card not found, or you do not have access to it')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('assignee picker toggles with DELETE then PUT', async () => {
    apiMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === '/cards/5/assignees/2') return { ...detail, assigneeIds: init?.method === 'DELETE' ? [] : [2] };
      return path === '/cards/5' ? detail : elsewhere(path, 'member');
    });
    render(
      <TrackingProvider lang="en">
        <CardPanel projectId={1} cardId={5} onClose={() => {}} />
      </TrackingProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Manage assignees' }));
    fireEvent.click(await screen.findByRole('option', { name: /Somchai/ }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/cards/5/assignees/2', { method: 'DELETE' }));
    await waitFor(() => expect(screen.getByText('Nobody assigned')).toBeTruthy());
    fireEvent.click(screen.getByRole('option', { name: /Somchai/ }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/cards/5/assignees/2', { method: 'PUT' }));
  });

  it('a label create conflict shows translated text', async () => {
    apiMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === '/projects/1/labels' && init?.method === 'POST') throw new ApiError('conflict', 409, 'duplicate');
      return path === '/cards/5' ? detail : elsewhere(path, 'pm');
    });
    render(
      <TrackingProvider lang="en">
        <CardPanel projectId={1} cardId={5} onClose={() => {}} />
      </TrackingProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Manage labels' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Create label' }));
    fireEvent.change(screen.getByLabelText('Label name'), { target: { value: 'Bug' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('This conflicts with the current state')).toBeTruthy();
  });
});
