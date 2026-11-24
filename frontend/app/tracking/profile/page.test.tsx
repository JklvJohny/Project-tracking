import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { api, apiBlob, ApiError } from '../shared/api/client';
import { TrackingProvider } from '../shared/provider';
import ProfilePage from './page';

vi.mock('../shared/api/client', async (orig) => ({ ...(await orig<object>()), api: vi.fn(), apiBlob: vi.fn() }));
vi.mock('sonner', async (orig) => ({
  ...(await orig<object>()),
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/tracking/profile',
  useSearchParams: () => new URLSearchParams('month=2026-11'),
}));
const apiMock = vi.mocked(api);

let avatarUrl: string;
let failUpload: ApiError | null;
type Init = { method?: string; body?: FormData; json?: { skills: string[] } };

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  avatarUrl = '';
  failUpload = null;
  apiMock.mockReset();
  vi.mocked(apiBlob).mockReset();
  vi.mocked(apiBlob).mockResolvedValue(new Blob(['x'], { type: 'image/jpeg' }));
  URL.createObjectURL = vi.fn(() => 'blob:avatar');
  vi.mocked(toast.success).mockReset();
  apiMock.mockImplementation((async (path: string, init?: Init) => {
    if (path === '/me') return { user: { id: 2, name: 'Napat K.', avatarUrl }, isAdmin: false, canCreateProject: true };
    if (path === '/team')
      return {
        asOf: '2026-11-20',
        people: [
          { userId: 2, name: 'Napat K.', avatarUrl, skills: ['Go', 'Scrum'], open: 4, overdue: 1, dueSoon: 2 },
          { userId: 3, name: 'Ann Lee', avatarUrl: '', skills: ['React'], open: 0, overdue: 0, dueSoon: 0 },
        ],
        catalog: [{ name: 'Go', categoryId: 1 }],
        categories: [{ id: 1, name: 'Programming' }],
      };
    if (path === '/me/tasks')
      return {
        asOf: '2026-11-20',
        tasks: [
          {
            cardId: 11, projectId: 5, projectName: 'Website', listName: 'To Do', title: 'Pricing page', priority: 'high',
            startDate: '2026-11-18', dueDate: '2026-11-24', daysLeft: 4, checklistTotal: 0, checklistDone: 0,
            assignees: [{ id: 2, name: 'Napat K.', avatarUrl: '' }],
          },
        ],
      };
    if (path === '/me/avatar' && init?.method === 'PUT') {
      if (failUpload) throw failUpload;
      avatarUrl = '/api/tracking/v1/users/2/avatar?v=1';
      return { avatarUrl };
    }
    if (path === '/me/avatar' && init?.method === 'DELETE') {
      avatarUrl = '';
      return { avatarUrl };
    }
    if (path === '/team/2/skills') return { skills: init!.json!.skills };
    // The viewer can open project 5, so its cards link to the board.
    if (path === '/projects') return [{ id: 5 }];
    throw new Error('unexpected ' + path);
  }) as never);
  render(
    <TrackingProvider lang="en">
      <ProfilePage />
    </TrackingProvider>,
  );
});
afterEach(cleanup);

const fileInput = () => screen.getByLabelText('New profile photo') as HTMLInputElement;

describe('Profile', () => {
  it('shows the person, their open work, their skills by category and their tasks in a month', async () => {
    expect(await screen.findByRole('heading', { name: 'Napat K.' })).toBeTruthy();
    // (The calendar legend says "Overdue" too: look inside the workload block.)
    const work = screen.getByRole('heading', { name: 'My work right now' }).parentElement!.parentElement!;
    await waitFor(() => expect(within(work).getByText('Open').nextSibling?.textContent).toBe('4'));
    expect(within(work).getByText('Overdue').nextSibling?.textContent).toBe('1');
    expect(within(work).getByText('Due in 7 days').nextSibling?.textContent).toBe('2');
    // Skills read like the Team page: Go under Programming, Scrum uncategorised.
    const skills = screen.getByRole('region', { name: 'Skills' });
    expect(within(skills).getByText('Programming').closest('dt')?.nextElementSibling?.textContent).toBe('Go');
    expect(within(skills).getByText('Uncategorised').closest('dt')?.nextElementSibling?.textContent).toBe('Scrum');
    // The task is on the calendar and opens on its project's board.
    const bar = (await screen.findAllByRole('link', { name: /^Pricing page\./ }))[0];
    expect(bar.getAttribute('href')).toBe('/tracking/5?card=11');
  });

  it('a new photo is checked first, then uploaded, and every query refetches', async () => {
    await screen.findByRole('heading', { name: 'Napat K.' });
    fireEvent.change(fileInput(), { target: { files: [new File(['x'], 'cv.pdf', { type: 'application/pdf' })] } });
    expect(screen.getByRole('alert').textContent).toBe('Only JPG, PNG or WebP files');
    expect(apiMock.mock.calls.some(([p]) => p === '/me/avatar')).toBe(false);

    fireEvent.change(fileInput(), { target: { files: [new File(['png'], 'me.png', { type: 'image/png' })] } });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Profile photo changed'));
    const call = apiMock.mock.calls.find(([p, i]) => p === '/me/avatar' && (i as Init).method === 'PUT')!;
    expect(((call[1] as Init).body!.get('file') as File).name).toBe('me.png');
    // The header refetched /me and now shows the uploaded picture, fetched with the api headers.
    await waitFor(() => expect(apiBlob).toHaveBeenCalledWith('/users/2/avatar?v=1'));
    expect(screen.getByRole('button', { name: 'Remove photo' })).toBeTruthy();
  });

  it('a server refusal shows inline', async () => {
    failUpload = new ApiError('validation_failed', 422, 'validation failed', { file: 'too_large' });
    await screen.findByRole('heading', { name: 'Napat K.' });
    fireEvent.change(fileInput(), { target: { files: [new File(['png'], 'big.png', { type: 'image/png' })] } });
    expect((await screen.findByRole('alert')).textContent).toBe('The file is over 5 MB or the picture is too big');
  });

  it('removing an uploaded photo asks first', async () => {
    avatarUrl = '/api/tracking/v1/users/2/avatar?v=1';
    cleanup();
    render(
      <TrackingProvider lang="en">
        <ProfilePage />
      </TrackingProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Remove photo' }));
    const ask = await screen.findByRole('alertdialog');
    fireEvent.click(within(ask).getByRole('button', { name: 'Remove photo' }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/me/avatar', { method: 'DELETE' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove photo' })).toBeNull());
  });

  it('skills edited here are saved for the Team page', async () => {
    fireEvent.click(await screen.findByRole('button', { name: "Edit Napat K.'s skills" }));
    const field = await screen.findByLabelText('Add a skill');
    fireEvent.change(field, { target: { value: 'Docker' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/team/2/skills', { method: 'PUT', json: { skills: ['Go', 'Scrum', 'Docker'] } }));
    expect(await within(screen.getByRole('region', { name: 'Skills' })).findByText('Docker')).toBeTruthy();
  });
});
