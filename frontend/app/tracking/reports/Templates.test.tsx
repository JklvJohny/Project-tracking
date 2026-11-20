import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { api } from '../shared/api/client';
import type { components } from '../shared/api/schema';
import { TrackingProvider } from '../shared/provider';
import ReportsPage from './page';

vi.mock('../shared/api/client', async (orig) => ({ ...(await orig<object>()), api: vi.fn(), apiBlob: vi.fn() }));
vi.mock('sonner', async (orig) => ({
  ...(await orig<object>()),
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams('tab=templates'),
}));
const apiMock = vi.mocked(api);

type T = components['schemas']['ReportTemplate'];
const tpl = (id: number, category: string, name: string, filename: string): T => ({
  id, category, name, description: '', filename, mimeType: 'application/pdf', sizeBytes: 1024, uploadedBy: 7,
  uploadedByName: 'Somchai Dee', createdAt: '2026-11-10T03:00:00Z', updatedAt: '2026-11-10T03:00:00Z',
});
let list: T[];

type Init = { method?: string; body?: FormData };
beforeEach(() => {
  list = [
    tpl(1, 'Weekly', 'Status update', 'status.docx'),
    tpl(2, 'Budget', 'Q1 plan', 'q1.xlsx'),
    tpl(3, 'Weekly', 'Risks', 'risks.pdf'),
    tpl(4, 'Budget', 'Old form', 'form.DOC'),
  ];
  apiMock.mockReset();
  vi.mocked(toast).mockReset();
  apiMock.mockImplementation((async (path: string, init?: Init) => {
    if (path === '/projects') return [];
    if (path === '/report-templates' && init?.method === 'POST') return tpl(9, 'Weekly', 'New one', 'new.pptx');
    if (path === '/report-templates') return list;
    if (init?.method === 'DELETE') return {};
    throw new Error('unexpected ' + path);
  }) as never);
  render(
    <TrackingProvider lang="en">
      <ReportsPage />
    </TrackingProvider>,
  );
});
afterEach(cleanup);

describe('Report templates', () => {
  it('lists templates in one table, grouped by category, with the file type spelled out', async () => {
    const table = await screen.findByRole('table', { name: 'Report templates by type' });
    const groups = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    expect(groups).toContain('Weekly (2)');
    expect(groups).toContain('Budget (2)');
    expect(within(table).getByText('DOCX')).toBeTruthy();
    // A legacy Word file says DOC, not DOCX.
    expect(within(table).getByText('DOC')).toBeTruthy();
    expect(within(table).getByText('XLSX')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Report templates' }).getAttribute('aria-current')).toBe('page');
  });

  it('search narrows the list', async () => {
    await screen.findByRole('table');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search templates' }), { target: { value: 'risk' } });
    expect(screen.queryByText('Status update')).toBeNull();
    expect(screen.getByText('Risks')).toBeTruthy();
  });

  it('upload asks for a file and a type first, then sends the text fields before the file', async () => {
    await screen.findByRole('table');
    fireEvent.click(screen.getAllByRole('button', { name: 'Upload template' })[0]);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Upload' }));
    expect(within(dialog).getAllByRole('alert').map((a) => a.textContent)).toEqual(['Required', 'Required', 'Required']);

    const input = dialog.ownerDocument.querySelector('input[type=file]') as HTMLInputElement;
    const bad = new File(['x'], 'tool.exe');
    fireEvent.change(input, { target: { files: [bad] } });
    expect(within(dialog).getByText(/Only Word \(\.docx, \.doc\)/)).toBeTruthy();
    // A legacy .doc is accepted.
    fireEvent.change(input, { target: { files: [new File(['x'], 'form.doc')] } });
    expect(within(dialog).queryByText(/Only Word/)).toBeNull();

    const file = new File(['PK'], 'Weekly status.pptx');
    fireEvent.change(input, { target: { files: [file] } });
    // The name follows the chosen file until typed.
    expect((within(dialog).getByLabelText('Template name') as HTMLInputElement).value).toBe('Weekly status');
    fireEvent.change(within(dialog).getByLabelText('Report type'), { target: { value: ' Weekly ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Upload' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const call = apiMock.mock.calls.find(([p, i]) => p === '/report-templates' && (i as Init)?.method === 'POST')!;
    const body = (call[1] as Init).body!;
    expect([...body.keys()]).toEqual(['category', 'name', 'description', 'file']);
    expect(body.get('category')).toBe('Weekly');
    expect(screen.getByText('New one')).toBeTruthy();
  });

  it('delete removes the row at once and offers Undo', async () => {
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Delete Q1 plan' }));
    await waitFor(() => expect(screen.queryByText('Q1 plan')).toBeNull());
    expect(apiMock).toHaveBeenCalledWith('/report-templates/2', { method: 'DELETE' });
    const [, opts] = vi.mocked(toast).mock.calls.at(-1)! as unknown as [string, { action: { label: string } }];
    expect(opts.action.label).toBe('Undo');
  });
});
