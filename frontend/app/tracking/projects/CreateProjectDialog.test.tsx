import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../shared/api/client';
import { TrackingProvider } from '../shared/provider';
import ProjectsPage from '../page';
import { CreateProjectDialog } from './CreateProjectDialog';

vi.mock('../shared/api/client', async (orig) => ({ ...(await orig<object>()), api: vi.fn() }));
const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(''),
}));

const apiMock = vi.mocked(api);

beforeEach(() => {
  apiMock.mockReset();
  replace.mockReset();
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

describe('ProjectsPage', () => {
  function mockApi(canCreateProject: boolean) {
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/me') return { user: { id: 1 }, isAdmin: false, canCreateProject };
      if (path === '/projects') return [];
      throw new Error('unexpected ' + path);
    });
  }

  it('create button hidden when canCreateProject false', async () => {
    mockApi(false);
    render(
      <TrackingProvider lang="en">
        <ProjectsPage />
      </TrackingProvider>,
    );
    await screen.findByText('No projects yet');
    expect(screen.queryByRole('button', { name: /New project/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Create/ })).toBeNull();
  });

  it('shows create button when canCreateProject true', async () => {
    mockApi(true);
    render(
      <TrackingProvider lang="en">
        <ProjectsPage />
      </TrackingProvider>,
    );
    await screen.findByText('No projects yet');
    expect(screen.getAllByRole('button', { name: /New project/ }).length).toBeGreaterThan(0);
  });
});
