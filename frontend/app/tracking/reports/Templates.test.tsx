import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { api, apiBlob } from '../shared/api/client';
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

describe('Template preview', () => {
  const blobMock = vi.mocked(apiBlob);
  beforeEach(() => {
    blobMock.mockReset();
    URL.createObjectURL = vi.fn(() => 'blob:preview');
    URL.revokeObjectURL = vi.fn();
  });

  it('a PDF opens in the viewer from the eye button or its name', async () => {
    blobMock.mockResolvedValue(new Blob(['%PDF-1.4'], { type: 'application/pdf' }));
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Preview Risks' }));
    const dialog = await screen.findByRole('dialog', { name: 'Risks' });
    expect(blobMock).toHaveBeenCalledWith('/report-templates/3/file', expect.anything());
    expect((await within(dialog).findByTitle('Risks')).getAttribute('src')).toBe('blob:preview');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
    fireEvent.click(screen.getByRole('button', { name: 'Risks' }));
    expect(await screen.findByRole('dialog', { name: 'Risks' })).toBeTruthy();
  });

  it('formats the browser cannot show (.doc) have no preview; the name downloads', async () => {
    blobMock.mockResolvedValue(new Blob(['x']));
    // jsdom cannot follow the download link the save makes.
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: 'Preview Old form' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Old form' }));
    await waitFor(() => expect(blobMock).toHaveBeenCalledWith('/report-templates/4/file'));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).toBeNull();
    click.mockRestore();
  });

  // 20 s: ExcelJS is a large dynamic import and can take seconds to load under the full parallel suite.
  it('an .xlsx shows as a table with its sheets, merges and text', async () => {
    const { default: ExcelJS } = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Plan');
    ws.getCell('A1').value = 'Quarter plan';
    ws.mergeCells('A1:C1');
    ws.getCell('A2').value = 'Item';
    ws.getCell('B2').value = 42;
    wb.addWorksheet('Notes').getCell('A1').value = 'see attached';
    const buf = await wb.xlsx.writeBuffer();
    blobMock.mockResolvedValue(new Blob([buf]));
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Preview Q1 plan' }));
    const dialog = await screen.findByRole('dialog', { name: 'Q1 plan' });
    const title = await within(dialog).findByText('Quarter plan', {}, { timeout: 15_000 });
    expect(title.closest('td')!.getAttribute('colspan')).toBe('3');
    expect(within(dialog).getByText('42')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Notes' }));
    expect(within(dialog).getByText('see attached')).toBeTruthy();
  }, 20_000);

  // 20 s: ExcelJS is a large dynamic import and can take seconds to load under the full parallel suite.
  it('a file that will not open says so and offers the download', async () => {
    blobMock.mockResolvedValue(new Blob(['not a zip']));
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Preview Q1 plan' }));
    const dialog = await screen.findByRole('dialog', { name: 'Q1 plan' });
    expect((await within(dialog).findByRole('alert', {}, { timeout: 15_000 })).textContent).toMatch(/could not be previewed/);
    expect(within(dialog).getAllByRole('button', { name: /Download/ }).length).toBeGreaterThan(0);
  }, 20_000);
});
