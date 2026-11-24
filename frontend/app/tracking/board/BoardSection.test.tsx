import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../shared/api/client';
import type { components } from '../shared/api/schema';
import { TrackingProvider } from '../shared/provider';
import { BOARD_OPEN_KEY, BoardSection } from './BoardSection';
import { useStoredOpen } from './useStoredOpen';

function Section() {
  const [open, setOpen] = useStoredOpen(BOARD_OPEN_KEY, true);
  return <BoardSection projectId={1} open={open} onOpenChange={setOpen} />;
}

vi.mock('../shared/api/client', async (orig) => ({ ...(await orig<object>()), api: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/tracking/1',
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

type B = components['schemas']['Board'];
const snap: B = {
  board: { id: 1, projectId: 1, updatedAt: 'x' },
  project: { id: 1, name: 'P' } as B['project'],
  myRole: 'pm',
  lists: [{ id: 1, boardId: 1, name: 'To do', position: 'a', isDone: false, wipLimit: null, archivedAt: null }],
  cards: [],
  labels: [],
  members: [],
  users: [],
};

function mount(lang: 'en' | 'th' = 'en') {
  vi.mocked(api).mockResolvedValue(snap);
  render(
    <TrackingProvider lang={lang}>
      <Section />
    </TrackingProvider>,
  );
}
beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/tracking/1');
});
afterEach(cleanup);

describe('BoardSection', () => {
  it('shows counts, collapses and remembers it', async () => {
    mount();
    const toggle = await screen.findByRole('button', { name: /Board · 1 list · 0 cards/ });
    expect(screen.getByRole('heading', { name: 'To do' })).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.queryByRole('heading', { name: 'To do' })).toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(localStorage.getItem('pt-board-open')).toBe('0');
    cleanup();
    mount();
    await screen.findByRole('button', { name: /Board/ });
    expect(screen.queryByRole('heading', { name: 'To do' })).toBeNull();
  });

  it('search hides cards that do not match, counts them, and Clear brings them back', async () => {
    const card = (id: number, title: string) => ({
      id, listId: 1, title, priority: 'low' as const, startDate: null, dueDate: null, position: String(id),
      completedAt: null, updatedAt: 'x', labelIds: [], assigneeIds: [], checklistTotal: 0, checklistDone: 0,
      commentCount: 0, checklistPreview: [],
    });
    vi.mocked(api).mockResolvedValue({ ...snap, cards: [card(1, 'Fix login'), card(2, 'Write docs')] });
    render(
      <TrackingProvider lang="en">
        <Section />
      </TrackingProvider>,
    );
    const search = await screen.findByRole('searchbox', { name: 'Search cards' });
    await screen.findByText('Write docs');
    fireEvent.change(search, { target: { value: 'LOGIN' } });
    expect(screen.queryByText('Write docs')).toBeNull();
    expect(screen.getByText('Fix login')).toBeTruthy();
    expect(screen.getByText('Showing 1 of 2 cards').getAttribute('role')).toBe('status');
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByText('Write docs')).toBeTruthy();
  });

  it('filter controls are translated', async () => {
    mount('th');
    expect((await screen.findByRole('searchbox')).getAttribute('aria-label')).toBe('ค้นหาการ์ด');
    for (const n of ['ผู้รับผิดชอบ', 'ป้ายกำกับ', 'ความสำคัญ', 'กำหนดส่ง'])
      expect(screen.getByRole('button', { name: new RegExp(n) })).toBeTruthy();
  });

  it('the filter is kept in the URL: a reload shows the same cards, and opening a card keeps it', async () => {
    const card = (id: number, title: string) => ({
      id, listId: 1, title, priority: 'low' as const, startDate: null, dueDate: null, position: String(id),
      completedAt: null, updatedAt: 'x', labelIds: [], assigneeIds: [], checklistTotal: 0, checklistDone: 0,
      commentCount: 0, checklistPreview: [],
    });
    vi.mocked(api).mockResolvedValue({ ...snap, cards: [card(1, 'Fix login'), card(2, 'Write docs')] });
    window.history.replaceState(null, '', '/tracking/1?card=9');
    render(
      <TrackingProvider lang="en">
        <Section />
      </TrackingProvider>,
    );
    fireEvent.change(await screen.findByRole('searchbox', { name: 'Search cards' }), { target: { value: 'login' } });
    // Other parameters (an open card) stay.
    expect(new URLSearchParams(window.location.search).get('q')).toBe('login');
    expect(new URLSearchParams(window.location.search).get('card')).toBe('9');
    expect(screen.getAllByRole('link', { name: /Fix login/ })[0].getAttribute('href')).toBe('/tracking/1?q=login&card=1');
    // A reload with that address starts filtered.
    cleanup();
    render(
      <TrackingProvider lang="en">
        <Section />
      </TrackingProvider>,
    );
    expect(((await screen.findByRole('searchbox', { name: 'Search cards' })) as HTMLInputElement).value).toBe('login');
    await screen.findByText('Fix login');
    expect(screen.queryByText('Write docs')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(window.location.search).toBe('?card=9');
  });
});
