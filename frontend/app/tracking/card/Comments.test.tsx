import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type ApiInit } from '../shared/api/client';
import type { components } from '../shared/api/schema';
import { TrackingProvider } from '../shared/provider';
import { Comments } from './Comments';

vi.mock('../shared/api/client', async (orig) => ({ ...(await orig<object>()), api: vi.fn() }));
const apiMock = vi.mocked(api);

type B = components['schemas']['Board'];
const comments = [
  { id: 1, cardId: 5, authorId: 2, bodyMd: 'mine **bold** <b>raw</b> hi @[3]', createdAt: '2026-11-01T00:00:00Z', editedAt: null, mentionIds: [3] },
  { id: 2, cardId: 5, authorId: 3, bodyMd: 'theirs', createdAt: '2026-11-02T00:00:00Z', editedAt: '2026-11-03T00:00:00Z', mentionIds: [] },
];
const board = (myRole: B['myRole']): B => ({
  board: { id: 1, projectId: 1, updatedAt: 'x' },
  project: { id: 1, name: 'P' } as B['project'],
  myRole,
  lists: [],
  cards: [{ id: 5, listId: 1, title: 'T', priority: 'low', startDate: null, dueDate: null, position: 'a', completedAt: null, updatedAt: 'x', labelIds: [], assigneeIds: [], checklistTotal: 0, checklistDone: 0, commentCount: 2 }],
  labels: [],
  members: [
    { userId: 2, name: 'Somchai', avatarUrl: '', role: 'member' },
    { userId: 3, name: 'Malee', avatarUrl: '', role: 'member' },
  ],
  users: [
    { id: 2, name: 'Somchai', avatarUrl: '' },
    { id: 3, name: 'Malee', avatarUrl: '' },
  ],
});

function setup(role: B['myRole'], me = 2) {
  apiMock.mockImplementation(async (path: string, init?: ApiInit) => {
    if (path === '/me') return { user: { id: me, name: 'x', avatarUrl: '' }, isAdmin: false, canCreateProject: false };
    if (path === '/projects/1/board') return board(role);
    if (path === '/cards/5/comments' && init?.method === 'POST')
      return { id: 9, cardId: 5, authorId: me, bodyMd: (init.json as { body: string }).body, createdAt: '2026-11-04T00:00:00Z', editedAt: null, mentionIds: [] };
    if (path === '/comments/1' && init?.method === 'PATCH')
      return { ...comments[0], bodyMd: (init.json as { body: string }).body, editedAt: '2026-11-05T00:00:00Z' };
    if (path === '/cards/5/comments') return comments;
    return {};
  });
  render(
    <TrackingProvider lang="en">
      <Comments projectId={1} cardId={5} />
    </TrackingProvider>,
  );
}

beforeEach(() => apiMock.mockReset());
afterEach(cleanup);

describe('Comments', () => {
  it('renders markdown without raw html and mentions as chips', async () => {
    setup('member');
    expect(await screen.findByText('bold')).toBeTruthy();
    expect(screen.getByText('bold').tagName).toBe('STRONG');
    expect(document.querySelector('b')).toBeNull();
    expect(document.querySelector('[data-mention="3"]')?.textContent).toBe('@Malee');
  });

  it('edit button only for author; delete for author', async () => {
    setup('member');
    await screen.findByText('theirs');
    expect(screen.getAllByRole('button', { name: /^Edit comment/ })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /^Delete comment/ })).toHaveLength(1);
  });

  it('pm can delete others comments but not edit them', async () => {
    setup('pm', 9);
    await screen.findByText('theirs');
    expect(screen.queryAllByRole('button', { name: /^Edit comment/ })).toHaveLength(0);
    expect(screen.getAllByRole('button', { name: /^Delete comment/ })).toHaveLength(2);
  });

  it('viewer sees comments but no editor or buttons', async () => {
    setup('viewer');
    await screen.findByText('theirs');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('posting appends the comment', async () => {
    setup('member');
    await screen.findByText('theirs');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'new one' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', ctrlKey: true });
    expect(await screen.findByText('new one')).toBeTruthy();
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/cards/5/comments', { method: 'POST', json: { body: 'new one' } }));
  });

  it('delete asks for confirmation, then removes the comment', async () => {
    setup('member');
    await screen.findByText('mine', { exact: false });
    fireEvent.click(screen.getByRole('button', { name: /^Delete comment/ }));
    expect(apiMock).not.toHaveBeenCalledWith('/comments/1', expect.anything());
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/comments/1', { method: 'DELETE' }));
    await waitFor(() => expect(screen.queryByText('bold')).toBeNull());
  });

  it('editing sends the body as `body`, the field the API expects', async () => {
    setup('member');
    await screen.findByText('mine', { exact: false });
    fireEvent.click(screen.getByRole('button', { name: /^Edit comment/ }));
    const box = screen.getAllByRole('textbox')[0];
    fireEvent.change(box, { target: { value: 'changed' } });
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/comments/1', { method: 'PATCH', json: { body: 'changed' } }));
  });

  it('Escape in an unsent comment is marked dirty so the panel stays open', async () => {
    setup('member');
    await screen.findByText('theirs');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'unsent' } });
    expect(screen.getByRole('textbox').closest('[data-inline-edit][data-dirty="true"]')).toBeTruthy();
    expect(apiMock).not.toHaveBeenCalledWith('/cards/5/comments', expect.objectContaining({ method: 'POST' }));
  });
});
