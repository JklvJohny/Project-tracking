import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { ApiError, api, apiBlob } from '../shared/api/client';
import { TrackingProvider } from '../shared/provider';
import ReportsPage from './page';

vi.mock('../shared/api/client', async (orig) => ({ ...(await orig<object>()), api: vi.fn(), apiBlob: vi.fn() }));
vi.mock('sonner', async (orig) => ({ ...(await orig<object>()), toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
let search = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search),
}));
const apiMock = vi.mocked(api);
const blobMock = vi.mocked(apiBlob);

const user = (id: number, name: string) => ({ id, name, avatarUrl: '' });
// The server's flags for the role, as document.folderOf sets them.
const folder = (id: number, name: string, documentCount = 0) => {
  const live = (id === 1 ? archived : null) === null;
  const editor = role !== 'viewer';
  return {
    id, name, archivedAt: id === 1 ? archived : null, documentCount, access: role,
    canUpload: live && editor, canShare: live && editor && role !== 'shared', canManage: live && (role === 'pm' || role === 'admin'),
  };
};
const doc = (id: number, filename: string, uploadedBy = 7) => ({
  id, projectId: 1, filename, mimeType: 'application/pdf', sizeBytes: 2048 * id, uploadedBy, uploadedByName: uploadedBy === 8 ? 'Mali Rak' : uploadedBy === 7 ? 'Somchai Dee' : '', createdAt: '2026-11-10T03:00:00Z',
});
const share = (userId: number, name: string) => ({ userId, name, avatarUrl: '', sharedBy: 8, createdAt: '2026-11-20T03:00:00Z' });
let shares: ReturnType<typeof share>[];
let docs: ReturnType<typeof doc>[];
let role = 'pm';
let archived: string | null = null;

type Init = { method?: string };
function impl() {
  return (async (path: string, init?: Init) => {
    if (path === '/me') return { user: user(8, 'Mali Rak'), isAdmin: false, canCreateProject: false };
    if (path === '/report-folders') return [folder(1, 'Website redesign', 3), folder(2, 'Mobile app', 5)];
    if (path === '/projects/1/folder-shares') return shares;
    if (path === '/projects/1/members') return [{ userId: 7, name: 'Somchai Dee', avatarUrl: '', role: 'pm', addedAt: '' }];
    if (path.startsWith('/users?q=')) return [user(7, 'Somchai Dee'), user(5, 'Ploy Outsider')];
    if (path === '/projects/1/folder-shares/5' && init?.method === 'PUT') return share(5, 'Ploy Outsider');
    if (path === '/projects/1/documents' && init?.method === 'POST') return doc(9, 'new.pdf', 8);
    if (path === '/projects/1/documents') return docs;
    if (path === '/projects/2/documents') return [];
    if (init?.method === 'DELETE' || init?.method === 'POST') return {};
    throw new Error('unexpected ' + path);
  }) as never;
}
function setup() {
  apiMock.mockImplementation(impl());
  return render(
    <TrackingProvider lang="en">
      <ReportsPage />
    </TrackingProvider>,
  );
}
const posted = () => apiMock.mock.calls.filter(([p, i]) => p === '/projects/1/documents' && (i as Init)?.method === 'POST');

let n = 0;
beforeEach(() => {
  apiMock.mockReset();
  blobMock.mockReset();
  vi.mocked(toast).mockReset();
  search = 'project=1';
  role = 'pm';
  archived = null;
  shares = [share(6, 'Niran Guest')];
  docs = [doc(1, 'Kickoff.pdf'), doc(2, 'Weekly.pdf', 8), doc(3, 'Scope.pdf')];
  blobMock.mockResolvedValue(new Blob(['%PDF-']));
  n = 0;
  URL.createObjectURL = vi.fn(() => `blob:doc-${++n}`);
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

const pdf = (name = 'a.pdf', size = 10) => {
  const f = new File(['%PDF-'], name, { type: 'application/pdf' });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

describe('Reports page', () => {
  it('lists project folders without a folder open', async () => {
    search = '';
    setup();
    expect(await screen.findByRole('link', { name: /Website redesign/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Mobile app/ })).toBeTruthy();
    expect(screen.getByText('Select a project')).toBeTruthy();
  });

  it('opening a folder lists its documents with a count on every folder', async () => {
    setup();
    const table = await screen.findByRole('grid');
    for (const h of ['Name', 'Size', 'Uploaded by', 'Date']) expect(within(table).getByRole('columnheader', { name: h })).toBeTruthy();
    expect(within(table).getByText('Kickoff.pdf')).toBeTruthy();
    expect(within(table).getByText('2 KB')).toBeTruthy();
    // uploader names come from the document itself; an uncached uploader is shown as unknown
    expect(within(table).getAllByText('Mali Rak').length).toBeGreaterThan(0);
    expect(within(screen.getByRole('link', { name: /Website redesign/ })).getByText('3')).toBeTruthy();
    // a folder that was not opened shows the count from the project list
    expect(within(screen.getByRole('link', { name: /Mobile app/ })).getByText('5')).toBeTruthy();
  });

  it('shows Unknown user #id when the uploader has no cached name', async () => {
    docs = [doc(1, 'Ghost.pdf', 9)];
    setup();
    expect((await screen.findAllByText('Unknown user #9')).length).toBeGreaterThan(0);
  });

  it('double-click opens the viewer with the authorised blob; arrows move; Escape closes', async () => {
    setup();
    fireEvent.doubleClick(await screen.findByRole('row', { name: /Kickoff/ }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.querySelector('iframe')?.getAttribute('src')).toBe('blob:doc-1'));
    expect(blobMock).toHaveBeenCalledWith('/documents/1/file', expect.anything());
    fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    await waitFor(() => expect(dialog.querySelector('iframe')?.getAttribute('src')).toBe('blob:doc-2'));
    expect(blobMock).toHaveBeenLastCalledWith('/documents/2/file', expect.anything());
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:doc-1');
    fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
    await waitFor(() => expect(blobMock).toHaveBeenCalledTimes(3));
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3));
  });

  it('Enter opens the focused row and arrow keys move the selection', async () => {
    setup();
    const first = await screen.findByRole('row', { name: /Kickoff/ });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    const second = screen.getByRole('row', { name: /Weekly/ });
    expect(document.activeElement).toBe(second);
    expect(second.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(second, { key: 'Enter' });
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(blobMock).toHaveBeenCalledWith('/documents/2/file', expect.anything()));
    expect(within(dialog).getByText('Weekly.pdf')).toBeTruthy();
  });

  it('rejects a non-PDF and an oversize file on the client with translated text', async () => {
    setup();
    const input = await screen.findByTestId('upload-input');
    fireEvent.change(input, { target: { files: [new File(['x'], 'a.txt', { type: 'text/plain' })] } });
    expect((await screen.findByRole('alert')).textContent).toBe('Only PDF files are supported');
    fireEvent.change(input, { target: { files: [pdf('big.pdf', 20 * 1024 * 1024 + 1)] } });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('The file is larger than 20 MB'));
    expect(posted()).toHaveLength(0);
  });

  it('upload posts FormData and adds the row', async () => {
    setup();
    fireEvent.change(await screen.findByTestId('upload-input'), { target: { files: [pdf('new.pdf')] } });
    expect(await screen.findByRole('row', { name: /new\.pdf/ })).toBeTruthy();
    const body = (posted()[0][1] as { body: FormData }).body;
    expect(body).toBeInstanceOf(FormData);
    expect((body.get('file') as File).name).toBe('new.pdf');
  });

  it('maps a server too_large field code to translated text', async () => {
    setup();
    const base = impl() as (p: string, i?: Init) => Promise<unknown>;
    apiMock.mockImplementation(((p: string, i?: Init) =>
      p === '/projects/1/documents' && i?.method === 'POST'
        ? Promise.reject(new ApiError('validation_failed', 422, 'x', { file: 'too_large' }))
        : base(p, i)) as never);
    fireEvent.change(await screen.findByTestId('upload-input'), { target: { files: [pdf()] } });
    expect((await screen.findByRole('alert')).textContent).toBe('The file is larger than 20 MB');
  });

  it('shows the archived text for a 409 project_archived upload', async () => {
    setup();
    const base = impl() as (p: string, i?: Init) => Promise<unknown>;
    apiMock.mockImplementation(((p: string, i?: Init) =>
      p === '/projects/1/documents' && i?.method === 'POST'
        ? Promise.reject(new ApiError('conflict', 409, 'project_archived'))
        : base(p, i)) as never);
    fireEvent.change(await screen.findByTestId('upload-input'), { target: { files: [pdf()] } });
    expect((await screen.findByRole('alert')).textContent).toBe('This project is archived and cannot be changed');
  });

  it('the viewer has one translated Close button, and a list change does not switch the viewed file', async () => {
    setup();
    fireEvent.doubleClick(await screen.findByRole('row', { name: /Kickoff/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getAllByRole('button', { name: 'Close' })).toHaveLength(1);
    // a new document lands at the top of the list while Kickoff is open
    fireEvent.change(screen.getByTestId('upload-input'), { target: { files: [pdf('new.pdf')] } });
    await waitFor(() => expect(posted()).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole('row', { name: /new\.pdf/, hidden: true })).toBeTruthy());
    expect(within(dialog).getByText('Kickoff.pdf')).toBeTruthy();
    expect(within(dialog).getByText(/2 of 4/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('delete asks to confirm, removes the row, and Undo restores it', async () => {
    setup();
    const row = await screen.findByRole('row', { name: /Kickoff/ });
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
    const confirm = await screen.findByRole('alertdialog');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByRole('row', { name: /Kickoff/ })).toBeNull());
    expect(apiMock).toHaveBeenCalledWith('/documents/1', { method: 'DELETE' });
    const opts = vi.mocked(toast).mock.calls[0][1] as { action: { label: string; onClick: () => void } };
    expect(opts.action.label).toBe('Undo');
    opts.action.onClick();
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/documents/1/restore', { method: 'POST' }));
  });

  it('a viewer sees no upload or delete', async () => {
    role = 'viewer';
    setup();
    await screen.findByRole('grid');
    expect(screen.queryByTestId('upload-input')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Upload PDF' })).toBeNull();
  });

  it('a member deletes only their own upload; an archived project has no controls', async () => {
    role = 'member';
    setup();
    await screen.findByRole('grid');
    expect(within(screen.getByRole('row', { name: /Weekly/ })).getByRole('button', { name: 'Delete' })).toBeTruthy();
    expect(within(screen.getByRole('row', { name: /Kickoff/ })).queryByRole('button', { name: 'Delete' })).toBeNull();
    cleanup();
    role = 'pm';
    archived = '2026-11-01T00:00:00Z';
    setup();
    await screen.findByRole('grid');
    expect(screen.queryByTestId('upload-input')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Share/ })).toBeNull();
  });

  it('someone the folder is shared with uploads and deletes only their own, and cannot share it on', async () => {
    role = 'shared';
    setup();
    await screen.findByRole('grid');
    expect(within(screen.getByRole('link', { name: /Website redesign/ })).getByText('Shared with you')).toBeTruthy();
    expect(screen.getByText('This folder is shared with you. You are not in this project.')).toBeTruthy();
    expect(screen.getByTestId('upload-input')).toBeTruthy();
    expect(within(screen.getByRole('row', { name: /Weekly/ })).getByRole('button', { name: 'Delete' })).toBeTruthy();
    expect(within(screen.getByRole('row', { name: /Kickoff/ })).queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Share/ })).toBeNull();
    expect(apiMock.mock.calls.some(([p]) => p.includes('folder-shares'))).toBe(false);
  });

  it('a member shares the folder with someone outside the project and can stop sharing', async () => {
    role = 'member';
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Share (1)' }));
    const dialog = await screen.findByRole('dialog', { name: 'Share the Website redesign folder' });
    const list = within(dialog).getByRole('region', { name: 'Shared with' });
    expect(await within(list).findByRole('button', { name: 'Stop sharing with Niran Guest' })).toBeTruthy();
    fireEvent.change(within(dialog).getByRole('searchbox', { name: 'Search people' }), { target: { value: 'o' } });
    // A project member cannot be shared with: they already see the folder.
    expect(await within(dialog).findByText('Project member')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Share with Ploy Outsider' }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/projects/1/folder-shares/5', { method: 'PUT' }));
    expect(await within(list).findByRole('button', { name: 'Stop sharing with Ploy Outsider' })).toBeTruthy();
    fireEvent.click(within(list).getByRole('button', { name: 'Stop sharing with Niran Guest' }));
    const confirm = await screen.findByRole('alertdialog');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Stop sharing' }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/projects/1/folder-shares/6', { method: 'DELETE' }));
    await waitFor(() => expect(within(list).queryByRole('button', { name: 'Stop sharing with Niran Guest' })).toBeNull());
  });
});
