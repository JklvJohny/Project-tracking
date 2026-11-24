import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { ApiError, api } from '../shared/api/client';
import { TrackingProvider } from '../shared/provider';
import { ProjectSettingsDialog } from './ProjectSettingsDialog';
import { pickOption } from '../shared/test-select';

vi.mock('../shared/api/client', async (orig) => ({ ...(await orig<object>()), api: vi.fn() }));
const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));
vi.mock('sonner', () => {
  const toast = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
  return { toast, Toaster: () => null };
});
const apiMock = vi.mocked(api);
const toastMock = vi.mocked(toast);

const project = {
  id: 1, name: 'Alpha', description: 'd', ownerId: 1, status: 'active', startDate: '2026-11-01', endDate: null, archivedAt: null,
};

beforeEach(() => {
  replace.mockReset();
  toastMock.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
  apiMock.mockReset();
  apiMock.mockImplementation((async (path: string) => {
    if (path === '/projects/1/board') return { project, myRole: 'pm', lists: [], cards: [], labels: [], members: [], users: [] };
    return { ...project, myRole: 'pm', archivedAt: path.endsWith('archive') ? 'now' : null };
  }) as never);
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderDialog() {
  return render(
    <TrackingProvider lang="en">
      <ProjectSettingsDialog projectId={1} open onOpenChange={() => {}} />
    </TrackingProvider>,
  );
}

describe('ProjectSettingsDialog', () => {
  it('saves edits; a cleared date is sent as null', async () => {
    renderDialog();
    fireEvent.change(await screen.findByLabelText(/Project name/), { target: { value: 'Beta' } });
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '' } });
    await pickOption(screen.getByRole('combobox', { name: 'Status' }), 'On hold');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/projects/1', {
        method: 'PATCH',
        json: { name: 'Beta', description: 'd', startDate: null, endDate: null, status: 'on_hold' },
      }),
    );
  });

  it('archive asks confirm, then goes back to the projects page', async () => {
    renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: 'Archive project' }));
    const confirm = await screen.findByRole('alertdialog');
    // The confirm button stays disabled until the project name is typed exactly.
    const ok = within(confirm).getByRole('button', { name: 'Archive project' });
    expect(ok.hasAttribute('disabled')).toBe(true);
    fireEvent.change(within(confirm).getByLabelText('Type "Alpha" to confirm'), { target: { value: 'alpha' } });
    expect(ok.hasAttribute('disabled')).toBe(true);
    fireEvent.change(within(confirm).getByLabelText('Type "Alpha" to confirm'), { target: { value: ' Alpha ' } });
    expect(ok.hasAttribute('disabled')).toBe(false);
    expect(apiMock).not.toHaveBeenCalledWith('/projects/1/archive', expect.anything());
    fireEvent.click(ok);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/tracking'));
    expect(apiMock).toHaveBeenCalledWith('/projects/1/archive', { method: 'POST' });
  });

  async function archiveThenUndo() {
    renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: 'Archive project' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.change(within(dialog).getByLabelText('Type "Alpha" to confirm'), { target: { value: 'Alpha' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive project' }));
    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    // The settings form is gone by now (dialog closed), as in the real app.
    cleanup();
    (toastMock.mock.calls[0][1] as unknown as { action: { onClick: () => void } }).action.onClick();
  }

  it('Undo restores the project and shows the restored toast', async () => {
    await archiveThenUndo();
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/projects/1/restore', { method: 'POST' }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('Project restored'));
  });

  it('a failing restore shows the error toast', async () => {
    const base = apiMock.getMockImplementation()!;
    apiMock.mockImplementation((async (path: string, init?: unknown) => {
      if (path.endsWith('/restore')) throw new ApiError('server_error', 500, 'boom');
      return base(path, init as never);
    }) as never);
    await archiveThenUndo();
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('Server error. Please try again'));
  });

  it('an archived project offers Restore instead of Archive, with the fields read-only', async () => {
    const base = apiMock.getMockImplementation()!;
    apiMock.mockImplementation((async (path: string, init?: unknown) =>
      path === '/projects/1/board'
        ? { project: { ...project, archivedAt: 'x' }, myRole: 'pm', lists: [], cards: [], labels: [], members: [], users: [] }
        : base(path, init as never)) as never);
    renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: 'Restore project' }));
    expect(screen.queryByRole('button', { name: 'Archive project' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect((screen.getByLabelText(/Project name/) as HTMLInputElement).disabled).toBe(true);
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/projects/1/restore', { method: 'POST' }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('Project restored'));
  });
});
