import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../shared/api/client';
import { TrackingProvider } from '../shared/provider';
import { ProjectSettingsDialog } from './ProjectSettingsDialog';

vi.mock('../shared/api/client', async (orig) => ({ ...(await orig<object>()), api: vi.fn() }));
const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));
const apiMock = vi.mocked(api);

const project = {
  id: 1, name: 'Alpha', description: 'd', ownerId: 1, status: 'active', startDate: '2026-11-01', endDate: null, archivedAt: null,
};

beforeEach(() => {
  replace.mockReset();
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
  it('saves edits; a cleared date is sent as an empty string', async () => {
    renderDialog();
    fireEvent.change(await screen.findByLabelText(/Project name/), { target: { value: 'Beta' } });
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'on_hold' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/projects/1', {
        method: 'PATCH',
        json: { name: 'Beta', description: 'd', startDate: '', endDate: '', status: 'on_hold' },
      }),
    );
  });

  it('archive asks confirm, then goes back to the projects page', async () => {
    renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: 'Archive project' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(apiMock).not.toHaveBeenCalledWith('/projects/1/archive', expect.anything());
    fireEvent.click(within(confirm).getByRole('button', { name: 'Archive project' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/tracking'));
    expect(apiMock).toHaveBeenCalledWith('/projects/1/archive', { method: 'POST' });
  });
});
