import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../shared/api/client';
import type { components } from '../shared/api/schema';
import { TrackingProvider } from '../shared/provider';
import BoardPage from './page';

vi.mock('../shared/api/client', async (orig) => ({ ...(await orig<object>()), api: vi.fn() }));
vi.mock('next/navigation', () => ({
  useParams: () => ({ projectId: '1' }),
  usePathname: () => '/tracking/1',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

type B = components['schemas']['Board'];
const snap = {
  board: { id: 1, projectId: 1, updatedAt: 'x' },
  project: { id: 1, name: 'P', status: 'active', archivedAt: null, ownerId: 1 },
  myRole: 'pm',
  lists: [],
  cards: [],
  labels: [],
  members: [],
  users: [],
} as unknown as B;

beforeEach(() => {
  localStorage.clear();
  vi.mocked(api).mockResolvedValue(snap);
});
afterEach(cleanup);

describe('board page: Timeline section', () => {
  it('shows a collapsed Timeline below the board and no splitter until both are open', async () => {
    render(
      <TrackingProvider lang="en">
        <BoardPage />
      </TrackingProvider>,
    );
    const toggle = await screen.findByRole('button', { name: /Timeline/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('separator')).toBeNull();
    fireEvent.click(toggle);
    expect(await screen.findByRole('separator', { name: 'Resize board and timeline' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Board/ }));
    expect(screen.queryByRole('separator')).toBeNull();
  });

  it('folding the Board with the splitter keeps the handle, and the handle brings it back', async () => {
    localStorage.setItem('pt-timeline-open', '1');
    localStorage.setItem('pt-split', '0.2');
    render(
      <TrackingProvider lang="en">
        <BoardPage />
      </TrackingProvider>,
    );
    const sep = await screen.findByRole('separator', { name: 'Resize board and timeline' });
    const board = () => screen.getByRole('button', { name: /^Board/ });
    fireEvent.keyDown(sep, { key: 'ArrowUp' });
    expect(board().getAttribute('aria-expanded')).toBe('false');
    const still = screen.getByRole('separator');
    expect(still.getAttribute('aria-valuenow')).toBe('0');
    fireEvent.keyDown(still, { key: 'ArrowDown' });
    expect(board().getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe('20');
  });
});
