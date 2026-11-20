import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../shared/api/client';
import type { components } from '../../shared/api/schema';
import { TrackingProvider } from '../../shared/provider';
import { CalendarView } from './Calendar';

let search = 'view=calendar';
vi.mock('../../shared/api/client', async (orig) => ({ ...(await orig<object>()), api: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/tracking/1',
  useSearchParams: () => new URLSearchParams(search),
}));

type B = components['schemas']['Board'];
const card = (o: Partial<B['cards'][number]> & { id: number }): B['cards'][number] => ({
  listId: 1, title: `c${o.id}`, priority: 'medium', startDate: null, dueDate: null, position: 'a', completedAt: null,
  updatedAt: 'x', labelIds: [], assigneeIds: [], checklistTotal: 0, checklistDone: 0, commentCount: 0, checklistPreview: [], ...o,
});
const snap: B = {
  board: { id: 1, projectId: 1, updatedAt: 'x' },
  project: { id: 1, name: 'P' } as B['project'],
  myRole: 'pm',
  lists: [],
  cards: [
    card({ id: 1, title: 'Build API', assigneeIds: [1], startDate: '2026-11-13', dueDate: '2026-11-19' }),
    card({ id: 2, title: 'Late task', dueDate: '2026-11-10' }),
    ...[3, 4, 5, 6, 7].map((id) => card({ id, title: `Busy ${id}`, dueDate: '2026-11-25' })),
    card({ id: 8, title: 'No dates card' }),
  ],
  labels: [],
  members: [],
  users: [{ id: 1, name: 'Ann Lee', avatarUrl: '' }],
};

function mount(lang: 'en' | 'th' = 'en') {
  vi.mocked(api).mockResolvedValue(snap);
  render(
    <TrackingProvider lang={lang}>
      <CalendarView projectId={1} />
    </TrackingProvider>,
  );
}
beforeEach(() => {
  search = 'view=calendar';
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 18, 12));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('CalendarView', () => {
  it('shows this month with each card linking to its panel and the status spelled out', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: 'November 2026' })).toBeTruthy();
    // A card crossing a week is one bar per week; both open the same card, `card` last so the panel finds its opener.
    const bars = await screen.findAllByRole('link', { name: /^Build API\. Nov 13, 2026 – Nov 19, 2026\. Active$/ });
    expect(bars.length).toBeGreaterThanOrEqual(2);
    expect(bars[0].getAttribute('href')).toBe('/tracking/1?view=calendar&card=1');
    expect(screen.getAllByRole('link', { name: /Late task.*Overdue/ }).length).toBeGreaterThan(0);
    expect(screen.getByText('1 card has no dates')).toBeTruthy();
  });

  it('month arrows keep the view and change only ?month=', async () => {
    search = 'view=calendar&month=2026-12';
    mount();
    expect(await screen.findByRole('heading', { name: 'December 2026' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Previous month' }).getAttribute('href')).toBe('/tracking/1?view=calendar&month=2026-11');
    expect(screen.getByRole('link', { name: 'Next month' }).getAttribute('href')).toBe('/tracking/1?view=calendar&month=2027-01');
    expect(screen.getByRole('link', { name: 'Today' }).getAttribute('href')).toBe('/tracking/1?view=calendar');
  });

  it('a busy day folds the overflow into "+n more", which lists every card of that day', async () => {
    mount();
    const more = await screen.findByRole('button', { name: /^1 more card on Wednesday, November 25$/ });
    fireEvent.click(more);
    const pop = await screen.findByRole('dialog');
    expect(within(pop).getAllByRole('link')).toHaveLength(5);
  });

  it('speaks Thai with a Buddhist-era month', async () => {
    mount('th');
    expect(await screen.findByRole('heading', { name: 'พฤศจิกายน 2569' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'เดือนถัดไป' })).toBeTruthy();
  });
});
