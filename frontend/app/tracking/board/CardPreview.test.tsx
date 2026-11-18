import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

describe('CardPreview controls inside a draggable row', () => {
  const withItems: Card = { ...base, checklistPreview: [{ id: 11, text: 'Write spec', isDone: false }] };
  const members = [{ userId: 2, name: 'Somchai Jai', avatarUrl: '', role: 'member' as const }];
  function renderIn(canEdit: boolean, row: () => void) {
    return render(
      <TrackingProvider lang="en">
        {/* stands in for the sortable row, whose dnd-kit activator listens to pointerdown */}
        <div onPointerDown={row}>
          <CardPreview projectId={7} card={withItems} users={users} labels={labels} members={members} canEdit={canEdit} />
        </div>
      </TrackingProvider>,
    );
  }

  it('pointer-down on a checkbox, its label, the subtask + and the assign + never reaches the row', () => {
    const row = vi.fn();
    renderIn(true, row);
    for (const el of [
      screen.getByRole('checkbox', { name: 'Write spec' }),
      screen.getByText('Write spec'),
      screen.getByRole('link', { name: 'Add subtask' }),
      screen.getByRole('button', { name: 'Add assignee' }),
    ])
      fireEvent.pointerDown(el);
    expect(row).not.toHaveBeenCalled();
    // the card body itself still starts a drag
    fireEvent.pointerDown(screen.getByText('Fix login'));
    expect(row).toHaveBeenCalledTimes(1);
  });

  it('a read-only checkbox row lets the click through to the card link', () => {
    renderIn(false, vi.fn());
    const label = screen.getByText('Write spec').closest('label')!;
    expect(label.className).not.toContain('pointer-events-auto');
    cleanup();
    renderIn(true, vi.fn());
    expect(screen.getByText('Write spec').closest('label')!.className).toContain('pointer-events-auto');
  });
});
