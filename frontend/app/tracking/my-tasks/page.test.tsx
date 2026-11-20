import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../shared/api/client';
import type { components } from '../shared/api/schema';
import { TrackingProvider } from '../shared/provider';
import MyTasksPage from './page';

vi.mock('../shared/api/client', async (orig) => ({ ...(await orig<object>()), api: vi.fn() }));

type S = components['schemas'];
type Task = S['MyTasks']['tasks'][number];
const me = { id: 2, name: 'Napat K.', avatarUrl: '' };
const ann = { id: 3, name: 'Ann', avatarUrl: '' };
const task = (over: Partial<Task>): Task => ({
  cardId: 1, projectId: 7, projectName: 'Web', listName: 'To Do', title: 'T', priority: 'high',
  startDate: null, dueDate: '2026-11-20', daysLeft: 2, checklistTotal: 0, checklistDone: 0, assignees: [me], ...over,
});

afterEach(cleanup);

function show(tasks: Task[]) {
  vi.mocked(api).mockImplementation(async (path: string) => {
    if (path === '/me') return { user: me, isAdmin: false, canCreateProject: true } satisfies S['Me'];
    return { asOf: '2026-11-18', tasks } satisfies S['MyTasks'];
  });
  render(
    <TrackingProvider lang="en">
      <MyTasksPage />
    </TrackingProvider>,
  );
}

describe('My tasks', () => {
  it('puts each task in its due-date column, linked to the card', async () => {
    show([
      task({ cardId: 1, title: 'Late', dueDate: '2026-11-15', daysLeft: -3 }),
      task({ cardId: 2, title: 'Now', dueDate: '2026-11-18', daysLeft: 0 }),
      task({ cardId: 3, title: 'Soon', assignees: [me, ann], checklistTotal: 4, checklistDone: 1 }),
      task({ cardId: 4, title: 'Whenever', dueDate: null, daysLeft: null }),
    ]);
    const column = async (name: string) => (await screen.findByRole('region', { name })) as HTMLElement;
    expect(within(await column('Overdue')).getByText('Late')).toBeTruthy();
    expect(within(await column('Today')).getByText('Now')).toBeTruthy();
    expect(within(await column('No due date')).getByText('Whenever')).toBeTruthy();
    // Every column stays, so the layout never shifts; an empty one says so.
    expect(within(await column('Later')).getByText('Nothing here')).toBeTruthy();
    expect(screen.getByText('Late').closest('a')!.getAttribute('href')).toBe('/tracking/7?card=1');
    expect(screen.getByText('3d overdue')).toBeTruthy();
    const soon = within(await column('Next 7 days')).getByText('Soon').closest('a')!;
    expect(within(soon).getByText('1 of 4 subtasks done')).toBeTruthy();
    // Only the other people on the card, never the caller.
    expect(within(soon).getByTitle('Ann')).toBeTruthy();
    expect(within(soon).queryByTitle('Napat K.')).toBeNull();
  });

  it('shows an empty state when nothing is open', async () => {
    show([]);
    expect(await screen.findByRole('heading', { name: 'Nothing open' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Overdue' })).toBeNull();
  });
});
