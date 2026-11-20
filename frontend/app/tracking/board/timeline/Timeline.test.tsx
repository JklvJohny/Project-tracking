import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../shared/api/client';
import type { components } from '../../shared/api/schema';
import { TrackingProvider } from '../../shared/provider';
import { useStoredOpen } from '../useStoredOpen';
import { TIMELINE_OPEN_KEY, TimelineSection } from './Timeline';

function Section() {
  const [open, setOpen] = useStoredOpen(TIMELINE_OPEN_KEY, false);
  return <TimelineSection projectId={1} open={open} onOpenChange={setOpen} />;
}

vi.mock('../../shared/api/client', async (orig) => ({ ...(await orig<object>()), api: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/tracking/1' }));

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
    card({ id: 1, title: 'Build API', assigneeIds: [1], startDate: '2026-11-17', dueDate: '2026-11-24' }),
    card({ id: 2, title: 'Late task', assigneeIds: [1], startDate: '2026-11-16', dueDate: '2026-11-17' }),
    card({ id: 3, title: 'No dates card' }),
  ],
  labels: [],
  members: [],
  users: [{ id: 1, name: 'Ann Lee', avatarUrl: '' }],
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
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 18, 12));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('TimelineSection', () => {
  it('is collapsed by default and remembers opening', async () => {
    mount();
    const toggle = await screen.findByRole('button', { name: /Timeline/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('link', { name: /Build API/ })).toBeNull();
    fireEvent.click(toggle);
    expect((await screen.findAllByText('Build API')).length).toBeGreaterThan(0);
    expect(localStorage.getItem('pt-timeline-open')).toBe('1');
  });

  it('renders a one-day card as a labelled milestone diamond, not a bar', async () => {
    localStorage.setItem('pt-timeline-open', '1');
    vi.mocked(api).mockResolvedValue({
      ...snap,
      cards: [card({ id: 7, title: 'Launch', assigneeIds: [1], startDate: '2026-11-19', dueDate: '2026-11-19' })],
    });
    render(
      <TrackingProvider lang="en">
        <Section />
      </TrackingProvider>,
    );
    const m = await screen.findByRole('link', { name: /^Milestone\. Ann Lee: Launch\./ });
    expect(m.getAttribute('data-kind')).toBe('milestone');
    expect(m.getAttribute('href')).toBe('/tracking/1?card=7');
    expect(m.textContent).toBe('');
  });

  it('renders labelled bars, the assignee group and the no-dates list', async () => {
    localStorage.setItem('pt-timeline-open', '1');
    mount();
    const bar = await screen.findByRole('link', { name: /Ann Lee: Build API\. .*Active/ });
    expect(bar.textContent).toContain('Build API');
    expect(bar.getAttribute('href')).toBe('/tracking/1?card=1');
    expect(screen.getByRole('link', { name: /Late task.*Overdue/ })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Ann Lee' })).toBeTruthy();
    expect(screen.getByText('No dates')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open card No dates card' }).getAttribute('href')).toBe('/tracking/1?card=3');
  });

  it('prev/next move the range by a week and Today comes back', async () => {
    localStorage.setItem('pt-timeline-open', '1');
    mount();
    await screen.findByRole('link', { name: /Late task/ });
    const range = () => screen.getByTestId('timeline-range').textContent;
    const first = range();
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
    expect(range()).not.toBe(first);
    expect(screen.queryByRole('link', { name: /Late task/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(range()).toBe(first);
  });

  it('translates labels to Thai', async () => {
    localStorage.setItem('pt-timeline-open', '1');
    mount('th');
    expect(await screen.findByRole('link', { name: /Ann Lee: Build API\. .*กำลังทำ/ })).toBeTruthy();
    expect(screen.getByText('ไม่มีวันที่')).toBeTruthy();
  });
});
