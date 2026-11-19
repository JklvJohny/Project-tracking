import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../shared/api/client';
import { TrackingProvider } from '../shared/provider';
import ArchivedProjectsPage from '../archived/page';
import ProjectsPage from '../page';
import { CreateProjectDialog } from './CreateProjectDialog';

vi.mock('../shared/api/client', async (orig) => ({ ...(await orig<object>()), api: vi.fn() }));
let searchStatus = '';
const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(searchStatus ? `status=${searchStatus}` : ''),
}));

const apiMock = vi.mocked(api);

beforeEach(() => {
  apiMock.mockReset();
  replace.mockReset();
  searchStatus = '';
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderDialog() {
  return render(
    <TrackingProvider lang="en">
      <CreateProjectDialog open onOpenChange={() => {}} />
    </TrackingProvider>,
  );
}

describe('CreateProjectDialog', () => {
  it('shows required error and focuses name on empty submit', async () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
    const name = screen.getByLabelText(/Project name/);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Required');
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(name);
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('maps server validation_failed endDate=before_start to field error', async () => {
    apiMock.mockRejectedValueOnce(
      new ApiError('validation_failed', 422, 'validation failed', { endDate: 'before_start' }),
    );
    renderDialog();
    fireEvent.change(screen.getByLabelText(/Project name/), { target: { value: 'Alpha' } });
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-12-10' } });
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-12-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Must not be before the start date');
    const end = screen.getByLabelText('End date');
    expect(end.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(end);
    expect(apiMock).toHaveBeenCalledWith('/projects', {
      method: 'POST',
      json: { name: 'Alpha', description: '', startDate: '2026-12-10', endDate: '2026-12-01', lang: 'en' },
    });
    expect(replace).not.toHaveBeenCalled();
  });

  it('redirects to the new project on success', async () => {
    apiMock.mockResolvedValueOnce({ id: 42, name: 'Alpha', archivedAt: null, status: 'active' });
    renderDialog();
    fireEvent.change(screen.getByLabelText(/Project name/), { target: { value: 'Alpha' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/tracking/42'));
  });
});

describe('CreateProjectDialog extras', () => {
  it('shows translated text for a non-field conflict error', async () => {
    apiMock.mockRejectedValueOnce(new ApiError('conflict', 409, 'conflict'));
    renderDialog();
    fireEvent.change(screen.getByLabelText(/Project name/), { target: { value: 'A' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
    expect((await screen.findByRole('alert')).textContent).toBe('This conflicts with the current state');
  });

  it('shows translated text for network_error', async () => {
    apiMock.mockRejectedValueOnce(new ApiError('network_error', 0, 'network error'));
    renderDialog();
    fireEvent.change(screen.getByLabelText(/Project name/), { target: { value: 'A' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Cannot reach the server');
  });

  it('clears errors and input after cancel and reopen', async () => {
    function Host() {
      const [open, setOpen] = useState(true);
      return (
        <TrackingProvider lang="en">
          <button onClick={() => setOpen(true)}>reopen</button>
          <CreateProjectDialog open={open} onOpenChange={setOpen} />
        </TrackingProvider>
      );
    }
    render(<Host />);
    fireEvent.change(screen.getByLabelText(/Project name/), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByLabelText(/Project name/)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'reopen' }));
    expect(await screen.findByLabelText(/Project name/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

const proj = (id: number, name: string, status: string, archivedAt: string | null) => ({
  id, name, description: '', ownerId: 1, status, startDate: null, endDate: null,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', archivedAt, myRole: 'pm',
});

describe('ProjectsPage', () => {
  function mockApi(canCreateProject: boolean, projects: unknown[] = []) {
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/me') return { user: { id: 1 }, isAdmin: false, canCreateProject };
      if (path === '/projects') return projects;
      throw new Error('unexpected ' + path);
    });
  }
  const renderPage = () =>
    render(
      <TrackingProvider lang="en">
        <ProjectsPage />
      </TrackingProvider>,
    );
  // Both queries must have settled before asserting on the gate.
  const settled = () =>
    waitFor(() => {
      const paths = apiMock.mock.calls.map((c) => c[0]);
      expect(paths).toContain('/me');
      expect(paths).toContain('/projects');
    });

  it('create button hidden when canCreateProject false', async () => {
    mockApi(false);
    renderPage();
    await screen.findByText('No projects yet');
    await settled();
    // Let the /me promise resolve and re-render before asserting absence.
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole('button', { name: /New project/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Create/ })).toBeNull();
  });

  it('shows create button when canCreateProject true', async () => {
    mockApi(true);
    renderPage();
    expect((await screen.findAllByRole('button', { name: /New project/ })).length).toBeGreaterThan(0);
  });

  it('filters: all and active hide archived; archived shows only archived', async () => {
    mockApi(false, [
      proj(1, 'Live A', 'active', null),
      proj(2, 'Held B', 'on_hold', null),
      proj(3, 'Old C', 'active', '2026-02-01T00:00:00Z'),
    ]);
    const { unmount } = renderPage();
    await screen.findByText('Live A');
    expect(screen.queryByText('Old C')).toBeNull();
    unmount();
    searchStatus = 'active';
    renderPage();
    await screen.findByText('Live A');
    expect(screen.queryByText('Held B')).toBeNull();
    expect(screen.queryByText('Old C')).toBeNull();
    cleanup();
    searchStatus = '';
    // Archived projects have their own page (sidebar), not a status filter.
    render(
      <TrackingProvider lang="en">
        <ArchivedProjectsPage />
      </TrackingProvider>,
    );
    await screen.findByText('Old C');
    expect(screen.getByRole('heading', { name: 'Archived projects' })).toBeTruthy();
    expect(screen.queryByText('Live A')).toBeNull();
    expect(screen.queryByRole('link', { name: /Archived/ })).toBeNull();
  });

  it('PM archives a project from the list after confirming; Undo restores it', async () => {
    const posts: string[] = [];
    apiMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === '/me') return { user: { id: 1 }, isAdmin: false, canCreateProject: true };
      if (path === '/projects') return [proj(1, 'Live A', 'active', null)];
      if (init?.method === 'POST') {
        posts.push(path);
        return proj(1, 'Live A', 'active', path.endsWith('/archive') ? '2026-11-19T00:00:00Z' : null);
      }
      throw new Error('unexpected ' + path);
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Archive Live A' }));
    // Asks first: nothing is sent until confirmed.
    const dialog = await screen.findByRole('alertdialog');
    expect(posts).toEqual([]);
    // Typing the project name enables the button; Enter confirms too.
    const input = within(dialog).getByLabelText('Type "Live A" to confirm');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(posts).toEqual([]);
    fireEvent.change(input, { target: { value: 'Live A' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(posts).toEqual(['/projects/1/archive']));
    // The archived project leaves the live list.
    await waitFor(() => expect(screen.queryByText('Live A')).toBeNull());
  });

  it('members and viewers get no archive button; archived page offers Restore to a PM', async () => {
    mockApi(false, [{ ...proj(1, 'Live A', 'active', null), myRole: 'member' }]);
    renderPage();
    await screen.findByText('Live A');
    expect(screen.queryByRole('button', { name: /Archive Live A/ })).toBeNull();
    cleanup();
    mockApi(false, [proj(3, 'Old C', 'active', '2026-02-01T00:00:00Z')]);
    render(
      <TrackingProvider lang="en">
        <ArchivedProjectsPage />
      </TrackingProvider>,
    );
    expect(await screen.findByRole('button', { name: 'Restore Old C' })).toBeTruthy();
  });
});
