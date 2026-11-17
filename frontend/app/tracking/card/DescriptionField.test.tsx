import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../shared/api/client';
import { TrackingProvider } from '../shared/provider';
import { DescriptionField } from './DescriptionField';

vi.mock('../shared/api/client', async (orig) => ({ ...(await orig<object>()), api: vi.fn() }));
const apiMock = vi.mocked(api);

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockResolvedValue({
    id: 5, listId: 1, title: 'T', descriptionMd: 'x', priority: 'low', startDate: null, dueDate: null, position: 'a',
    completedAt: null, createdAt: 'x', updatedAt: 'x', archivedAt: null, assigneeIds: [], labelIds: [], checklist: [],
  });
});
afterEach(cleanup);

function renderField(value: string, readOnly = false) {
  return render(
    <TrackingProvider lang="en">
      <DescriptionField projectId={1} cardId={5} value={value} readOnly={readOnly} />
    </TrackingProvider>,
  );
}

describe('DescriptionField', () => {
  it('description preview does not render raw html', () => {
    const { container } = renderField('<img src=x onerror=alert(1)>\n\n**bold**');
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText(/<img src=x onerror=alert\(1\)>/)).toBeTruthy();
    expect(container.querySelector('strong')?.textContent).toBe('bold');
  });

  it('links open in a new tab with noopener', () => {
    renderField('[docs](https://example.com)');
    const a = screen.getByRole('link', { name: 'docs' });
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('saves once on blur and shows Saved', async () => {
    renderField('');
    const ta = screen.getByLabelText('Description') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'hello' } });
    fireEvent.blur(ta);
    fireEvent.blur(ta);
    await waitFor(() => expect(screen.getByText('Saved')).toBeTruthy());
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock).toHaveBeenCalledWith('/cards/5', { method: 'PATCH', json: { descriptionMd: 'hello' } });
  });

  it('read-only shows no textarea', () => {
    renderField('hi', true);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
