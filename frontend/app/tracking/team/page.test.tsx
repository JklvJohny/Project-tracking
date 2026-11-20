import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { api, ApiError } from '../shared/api/client';
import { TrackingProvider } from '../shared/provider';
import TeamPage from './page';
import { cleanSkills, type Person } from './queries';

vi.mock('../shared/api/client', async (orig) => ({ ...(await orig<object>()), api: vi.fn() }));
vi.mock('sonner', async (orig) => ({
  ...(await orig<object>()),
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}));
const apiMock = vi.mocked(api);

const person = (userId: number, name: string, skills: string[], open = 0, overdue = 0, dueSoon = 0): Person => ({
  userId, name, avatarUrl: '', skills, open, overdue, dueSoon,
});
let people: Person[];
let failPut = false;

type Init = { method?: string; json?: { skills: string[] } };
beforeEach(() => {
  failPut = false;
  people = [
    person(3, 'Ann Lee', ['React', 'Go'], 5, 1, 2),
    person(4, 'Ben Ko', ['Go', 'PostgreSQL'], 1),
    person(2, 'Napat K.', []),
  ];
  apiMock.mockReset();
  vi.mocked(toast.error).mockReset();
  apiMock.mockImplementation((async (path: string, init?: Init) => {
    if (path === '/me') return { user: { id: 2, name: 'Napat K.', avatarUrl: '' }, isAdmin: false, canCreateProject: true };
    if (path === '/team') return { asOf: '2026-11-20', people };
    if (init?.method === 'PUT') {
      if (failPut) throw new ApiError('server_error', 500, 'boom');
      return { skills: init.json!.skills };
    }
    throw new Error('unexpected ' + path);
  }) as never);
  render(
    <TrackingProvider lang="en">
      <TeamPage />
    </TrackingProvider>,
  );
});
afterEach(cleanup);

const card = (name: string) => screen.getByRole('heading', { name: new RegExp(name) }).closest('li')!;

describe('Team page', () => {
  it('shows each person with skills and workload, and marks the caller', async () => {
    const list = await screen.findByRole('list', { name: 'Team members' });
    expect(within(list).getAllByRole('heading').map((h) => h.textContent)).toEqual(['Ann Lee', 'Ben Ko', 'Napat K.You']);
    const ann = card('Ann Lee');
    expect(within(ann).getByText('5 open')).toBeTruthy();
    expect(within(ann).getByText('1 overdue')).toBeTruthy();
    expect(within(ann).getByText('2 due in 7 days')).toBeTruthy();
    expect(within(card('Napat')).getByText('Nothing open')).toBeTruthy();
    expect(within(card('Napat')).getByText('No skills listed yet')).toBeTruthy();
  });

  it('filters by skill (every chosen skill), by text, and sorts least busy first', async () => {
    await screen.findByRole('list', { name: 'Team members' });
    const bar = screen.getByRole('list', { name: 'Filter by skill' });
    // Most common first.
    expect(within(bar).getAllByRole('button').map((b) => b.textContent)).toEqual(['Go 2', 'PostgreSQL 1', 'React 1']);
    fireEvent.click(within(bar).getByRole('button', { name: /^Go/ }));
    expect(screen.getByRole('status').textContent).toBe('Showing 2 of 3 people');
    // A skill on a card adds to the filter too: Go AND React leaves Ann.
    fireEvent.click(within(card('Ann Lee')).getByRole('button', { name: 'React' }));
    expect(screen.queryByRole('heading', { name: 'Ben Ko' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search name or skill' }), { target: { value: 'postg' } });
    expect(screen.getByRole('status').textContent).toBe('Showing 1 of 3 people');
  });

  it('edits skills: Enter adds, duplicates fold, Save sends the list and the card updates at once', async () => {
    await screen.findByRole('list', { name: 'Team members' });
    fireEvent.click(screen.getByRole('button', { name: "Edit Ben Ko's skills" }));
    const field = await screen.findByLabelText('Add a skill');
    fireEvent.change(field, { target: { value: '  docker ' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    fireEvent.change(field, { target: { value: 'go, CI/CD' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/team/4/skills', { method: 'PUT', json: { skills: ['Go', 'PostgreSQL', 'docker', 'CI/CD'] } }));
    expect(within(card('Ben Ko')).getByRole('button', { name: 'CI/CD' })).toBeTruthy();
  });

  it('refuses a skill over 40 characters with an inline error', async () => {
    await screen.findByRole('list', { name: 'Team members' });
    fireEvent.click(screen.getByRole('button', { name: 'Add skills' }));
    const field = await screen.findByLabelText('Add a skill');
    fireEvent.change(field, { target: { value: 'x'.repeat(41) } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert').textContent).toBe('A skill can be at most 40 characters');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(apiMock.mock.calls.some(([, i]) => (i as Init)?.method === 'PUT')).toBe(false);
  });

  it('a failed save puts the old skills back and says so', async () => {
    failPut = true;
    await screen.findByRole('list', { name: 'Team members' });
    fireEvent.click(screen.getByRole('button', { name: "Edit Ann Lee's skills" }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove React' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    await waitFor(() => expect(within(card('Ann Lee')).getByRole('button', { name: 'React' })).toBeTruthy());
  });
});

describe('cleanSkills', () => {
  it('trims, squeezes spaces and keeps the first spelling of a duplicate', () => {
    expect(cleanSkills([' UX   design ', 'go', 'Go', '', 'ux design'])).toEqual(['UX design', 'go']);
  });
});
