import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../shared/api/client';
import type { components } from '../shared/api/schema';
import { TrackingProvider } from '../shared/provider';
import { Board } from './Board';

vi.mock('../shared/api/client', async (orig) => ({ ...(await orig<object>()), api: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/tracking/1' }));

const apiMock = vi.mocked(api);

function snapshot(myRole: components['schemas']['MyRole']): components['schemas']['Board'] {
  return {
    board: { id: 1, projectId: 1, updatedAt: '2026-11-17T00:00:00Z' },
    project: { id: 1, name: 'P' } as components['schemas']['Board']['project'],
    myRole,
    lists: [{ id: 1, boardId: 1, name: 'To do', position: 'a', isDone: false, wipLimit: null, archivedAt: null }],
    cards: [],
    labels: [],
    members: [],
    users: [],
  };
}

beforeEach(() => apiMock.mockReset());
afterEach(cleanup);

async function renderAs(role: components['schemas']['MyRole']) {
  apiMock.mockResolvedValue(snapshot(role));
  render(
    <TrackingProvider lang="en">
      <Board projectId={1} />
    </TrackingProvider>,
  );
  await screen.findByRole('heading', { name: 'To do' });
}

describe('Board permissions', () => {
  it('viewer sees no add or edit controls', async () => {
    await renderAs('viewer');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('member can add cards but not manage lists', async () => {
    await renderAs('member');
    expect(screen.getByRole('button', { name: /Add card/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Add list/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Actions for list/ })).toBeNull();
  });

  it('pm can add lists and open the list menu', async () => {
    await renderAs('pm');
    expect(screen.getByRole('button', { name: 'Add list' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Actions for list To do' })).toBeTruthy();
  });

  // Absolute children (sr-only counters) escape an overflow scroller unless it is a containing block:
  // without `relative` the whole page gained a horizontal scrollbar on narrow screens.
  it('the lists scroller is positioned so it clips its absolute children', async () => {
    await renderAs('pm');
    const scroller = screen.getByRole('group', { name: 'Lists' });
    expect(scroller.className).toContain('relative');
    expect(scroller.className).toContain('overflow-x-auto');
  });
});
