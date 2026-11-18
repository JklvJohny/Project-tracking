import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../shared/api/client';
import type { components } from '../shared/api/schema';
import { TrackingProvider } from '../shared/provider';
import { BoardSection } from './BoardSection';

vi.mock('../shared/api/client', async (orig) => ({ ...(await orig<object>()), api: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/tracking/1' }));

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
      <BoardSection projectId={1} />
    </TrackingProvider>,
  );
}
beforeEach(() => localStorage.clear());
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

  it('filter placeholders are disabled, aria-disabled and translated', async () => {
    mount('th');
    const search = await screen.findByRole('searchbox');
    expect(search.hasAttribute('disabled')).toBe(true);
    expect(search.getAttribute('aria-disabled')).toBe('true');
    expect(search.getAttribute('aria-label')).toBe('ค้นหาการ์ด');
    for (const n of ['ผู้รับผิดชอบ', 'ป้ายกำกับ', 'ความสำคัญ', 'กำหนดส่ง']) {
      const b = screen.getByRole('button', { name: new RegExp(n) });
      expect(b.hasAttribute('disabled')).toBe(true);
      expect(b.getAttribute('aria-disabled')).toBe('true');
    }
  });
});
