import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { api, ApiError } from '../shared/api/client';
import { TrackingProvider } from '../shared/provider';
import TeamPage from './page';
import { cleanSkills, groupSkills, type CatalogEntry, type Category, type Person } from './queries';

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
let catalog: CatalogEntry[];
let categories: Category[];

type Init = {
  method?: string;
  json?: { skills: string[]; name?: string; userIds?: number[]; categoryId?: number | null };
};
const view = () => ({ asOf: '2026-11-20', people, catalog, categories });
beforeEach(() => {
  // Radix Checkbox measures itself.
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  failPut = false;
  localStorage.clear();
  categories = [
    { id: 1, name: 'Programming' },
    { id: 2, name: 'Network' },
  ];
  catalog = [
    { name: 'Kotlin', categoryId: 1 },
    { name: 'Go', categoryId: 1 },
  ];
  people = [
    person(3, 'Ann Lee', ['React', 'Go'], 5, 1, 2),
    person(4, 'Ben Ko', ['Go', 'PostgreSQL'], 1),
    person(2, 'Napat K.', []),
  ];
  apiMock.mockReset();
  vi.mocked(toast.error).mockReset();
  apiMock.mockImplementation((async (path: string, init?: Init) => {
    if (path === '/me') return { user: { id: 2, name: 'Napat K.', avatarUrl: '' }, isAdmin: false, canCreateProject: true };
    if (path === '/team') return view();
    if (path === '/team/skills' && init?.method === 'POST') {
      const { name, userIds, categoryId = null } = init.json!;
      catalog = [...catalog, { name: name!, categoryId }];
      people = people.map((p) => (userIds!.includes(p.userId) ? { ...p, skills: [...p.skills, name!] } : p));
      return view();
    }
    if (path === '/team/skills/category') {
      const { name, categoryId = null } = init!.json!;
      catalog = [...catalog.filter((c) => c.name !== name), { name: name!, categoryId }];
      return view();
    }
    if (path === '/team/categories') {
      categories = [...categories, { id: 9, name: init!.json!.name! }];
      return view();
    }
    const cat = /^\/team\/categories\/(\d+)$/.exec(path);
    if (cat && init?.method === 'PATCH') {
      categories = categories.map((c) => (c.id === Number(cat[1]) ? { ...c, name: init.json!.name! } : c));
      return view();
    }
    if (cat && init?.method === 'DELETE') {
      categories = categories.filter((c) => c.id !== Number(cat[1]));
      catalog = catalog.map((c) => (c.categoryId === Number(cat[1]) ? { ...c, categoryId: null } : c));
      return view();
    }
    if (init?.method === 'DELETE') return {};
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
    // Folded by default; the toggle remembers.
    const toggle = screen.getByRole('button', { name: /All skills/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('list', { name: 'Filter by skill' })).toBeNull();
    fireEvent.click(toggle);
    expect(localStorage.getItem('pt-team-skills-open')).toBe('1');
    const bar = screen.getByRole('group', { name: 'Filter by skill' });
    // By category, most common first within each; uncategorised last; an empty category says so.
    expect(within(bar).getAllByRole('button', { pressed: false }).map((b) => b.textContent)).toEqual(['Go 2', 'Kotlin 0', 'PostgreSQL 1', 'React 1']);
    expect(within(within(bar).getByRole('list', { name: 'Programming' })).getAllByRole('listitem')).toHaveLength(2);
    expect(within(bar).getByText('No skills in this category yet')).toBeTruthy();
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

describe('Skill list', () => {
  it('folded, the chosen filters stay visible and can be dropped', async () => {
    await screen.findByRole('list', { name: 'Team members' });
    fireEvent.click(within(card('Ann Lee')).getByRole('button', { name: 'React' }));
    const chosen = screen.getByRole('list', { name: 'Chosen skills' });
    fireEvent.click(within(chosen).getByRole('button', { name: 'Stop filtering by React' }));
    expect(screen.getByRole('status').textContent).toBe('Showing 3 of 3 people');
  });

  it('adds a new skill and gives it to the people ticked', async () => {
    await screen.findByRole('list', { name: 'Team members' });
    fireEvent.click(screen.getByRole('button', { name: 'New skill' }));
    const field = await screen.findByLabelText('Skill name');
    fireEvent.change(field, { target: { value: '  Rust  ' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Napat K\./ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/team/skills', { method: 'POST', json: { name: 'Rust', userIds: [2], categoryId: null } }),
    );
    expect(await within(card('Napat')).findByRole('button', { name: 'Rust' })).toBeTruthy();
  });

  it('refuses an existing name with nobody ticked, without calling the server', async () => {
    await screen.findByRole('list', { name: 'Team members' });
    fireEvent.click(screen.getByRole('button', { name: 'New skill' }));
    fireEvent.change(await screen.findByLabelText('Skill name'), { target: { value: 'go' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('alert').textContent).toMatch(/already listed/);
    expect(apiMock.mock.calls.some(([p]) => p === '/team/skills')).toBe(false);
  });

  it('removes an unused skill from the list at once and offers Undo', async () => {
    await screen.findByRole('list', { name: 'Team members' });
    fireEvent.click(screen.getByRole('button', { name: /All skills/ }));
    // Only unused skills can be removed.
    expect(screen.queryByRole('button', { name: 'Remove Go from the skill list' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Kotlin from the skill list' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Kotlin/ })).toBeNull());
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/team/skills?name=Kotlin', { method: 'DELETE' }));
    const [, opts] = vi.mocked(toast).mock.calls.at(-1)! as unknown as [string, { action: { label: string; onClick: () => void } }];
    expect(opts.action.label).toBe('Undo');
    // Undo puts it back in its category.
    opts.action.onClick();
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/team/skills', { method: 'POST', json: { name: 'Kotlin', userIds: [], categoryId: 1 } }),
    );
  });
});

describe('Skill categories', () => {
  it('the + beside a category adds a skill straight into it', async () => {
    await screen.findByRole('list', { name: 'Team members' });
    fireEvent.click(screen.getByRole('button', { name: /All skills/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add a skill to Network' }));
    expect((await screen.findByRole('combobox', { name: 'Category' })).textContent).toBe('Network');
    fireEvent.change(screen.getByLabelText('Skill name'), { target: { value: 'BGP' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/team/skills', { method: 'POST', json: { name: 'BGP', userIds: [], categoryId: 2 } }),
    );
    expect(await within(screen.getByRole('group', { name: 'Filter by skill' })).findByRole('list', { name: 'Network' })).toBeTruthy();
  });

  it('an existing name with nobody ticked is still sent when it moves to another category', async () => {
    await screen.findByRole('list', { name: 'Team members' });
    fireEvent.click(screen.getByRole('button', { name: /All skills/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add a skill to Network' }));
    fireEvent.change(await screen.findByLabelText('Skill name'), { target: { value: 'go' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/team/skills', { method: 'POST', json: { name: 'go', userIds: [], categoryId: 2 } }),
    );
  });

  it('adds, renames and moves skills between categories in the dialog', async () => {
    await screen.findByRole('list', { name: 'Team members' });
    fireEvent.click(screen.getByRole('button', { name: 'Categories' }));
    const dialog = await screen.findByRole('dialog', { name: 'Skill categories' });
    // Focus starts on the new-category field, not on an existing name a keystroke would change.
    const name = within(dialog).getByRole('textbox', { name: 'New category' });
    expect(document.activeElement).toBe(name);
    // A clash is caught before the server.
    fireEvent.change(name, { target: { value: ' network ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add category' }));
    expect(within(dialog).getByRole('alert').textContent).toBe('A category with this name exists');
    fireEvent.change(name, { target: { value: 'Cybersecurity' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add category' }));
    expect(await within(dialog).findByRole('textbox', { name: 'Name of category Cybersecurity' })).toBeTruthy();

    // Rename on blur.
    const net = within(dialog).getByRole('textbox', { name: 'Name of category Network' });
    fireEvent.change(net, { target: { value: 'Networking' } });
    fireEvent.blur(net);
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/team/categories/2', { method: 'PATCH', json: { name: 'Networking' } }),
    );

    // Move a skill that is only on people's cards.
    const trigger = within(dialog).getByRole('combobox', { name: 'Category of PostgreSQL' });
    expect(trigger.textContent).toBe('Uncategorised');
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    fireEvent.click(await screen.findByRole('option', { name: 'Programming' }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/team/skills/category', { method: 'PUT', json: { name: 'PostgreSQL', categoryId: 1 } }),
    );
    await waitFor(() =>
      expect(within(dialog).getByRole('combobox', { name: 'Category of PostgreSQL' }).textContent).toBe('Programming'),
    );
  });

  it('asks before deleting a category that has skills', async () => {
    await screen.findByRole('list', { name: 'Team members' });
    fireEvent.click(screen.getByRole('button', { name: 'Categories' }));
    const dialog = await screen.findByRole('dialog', { name: 'Skill categories' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete category Programming' }));
    const ask = await screen.findByRole('alertdialog');
    expect(ask.textContent).toMatch(/Its 2 skills move to "Uncategorised"/);
    fireEvent.click(within(ask).getByRole('button', { name: 'Delete category' }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/team/categories/1', { method: 'DELETE' }));
  });
});

describe('groupSkills', () => {
  it('keeps category order, lists empty categories and puts uncategorised last', () => {
    const g = groupSkills(
      [
        { name: 'Go', count: 2, categoryId: 2 },
        { name: 'Excel', count: 1, categoryId: null },
        { name: 'Old', count: 1, categoryId: 7 },
      ],
      [
        { id: 1, name: 'Network' },
        { id: 2, name: 'Programming' },
      ],
    );
    expect(g.map((x) => [x.category?.name ?? null, x.skills.map((s) => s.name)])).toEqual([
      ['Network', []],
      ['Programming', ['Go']],
      // A category that no longer exists counts as none.
      [null, ['Excel', 'Old']],
    ]);
  });
});
