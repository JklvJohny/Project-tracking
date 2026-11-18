import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { components } from '../shared/api/schema';
import { TrackingProvider } from '../shared/provider';
import { CardPreview } from './CardPreview';

vi.mock('next/navigation', () => ({ usePathname: () => '/tracking/7' }));

type Card = components['schemas']['CardSummary'];
const base: Card = {
  id: 5,
  listId: 1,
  title: 'Fix login',
  priority: 'urgent',
  startDate: null,
  dueDate: '2020-01-01',
  position: 'a',
  completedAt: null,
  updatedAt: '2026-11-17T00:00:00Z',
  labelIds: [1],
  assigneeIds: [2],
  checklistTotal: 4,
  checklistDone: 1,
  commentCount: 3,
  checklistPreview: [],
};
const users = [{ id: 2, name: 'Somchai Jai', avatarUrl: '' }];
const labels = [{ id: 1, name: 'Bug', color: 'red' as const }];

function renderCard(card: Card, lang: 'th' | 'en' = 'en') {
  return render(
    <TrackingProvider lang={lang}>
      <CardPreview projectId={7} card={card} users={users} labels={labels} members={[]} canEdit={false} />
    </TrackingProvider>,
  );
}
afterEach(cleanup);

describe('CardPreview', () => {
  it('shows overdue chip only when not completed', () => {
    renderCard(base);
    expect(screen.getByText(/Overdue/)).toBeTruthy();
    cleanup();
    renderCard({ ...base, completedAt: '2026-11-01T00:00:00Z' });
    expect(screen.queryByText(/Overdue/)).toBeNull();
    expect(screen.getByText(/Jan/)).toBeTruthy();
  });

  it('priority badge text is translated', () => {
    renderCard(base, 'en');
    expect(screen.getByText('Urgent').getAttribute('style')).toContain('var(--pb-urgent)');
    cleanup();
    renderCard(base, 'th');
    expect(screen.getByText('เร่งด่วน')).toBeTruthy();
  });

  it('is a link to ?card=id keeping the path, with subtask count, label and comments', () => {
    renderCard(base);
    const a = screen.getByRole('link');
    expect(a.getAttribute('href')).toBe('/tracking/7?card=5');
    expect(screen.getByText('Bug')).toBeTruthy();
    expect(screen.getByText('1/4')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('Fix login')).toBeTruthy();
  });
});
