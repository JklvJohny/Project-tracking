import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TrackingProvider } from '../shared/provider';
import { CommentEditor } from './CommentEditor';
import { inlineEscape } from './inline';

afterEach(cleanup);
const members = [
  { id: 2, name: 'Somchai' },
  { id: 3, name: 'Malee' },
];

function setup(onSubmit = vi.fn<(text: string) => Promise<unknown>>(async () => ({}))) {
  render(
    <TrackingProvider lang="en">
      <CommentEditor members={members} onSubmit={onSubmit} submitLabel="Send" />
    </TrackingProvider>,
  );
  return { onSubmit, box: screen.getByRole('textbox') as HTMLTextAreaElement };
}

/** Types `value` with the caret at its end, as a user would. */
function type(box: HTMLTextAreaElement, value: string) {
  box.focus();
  fireEvent.change(box, { target: { value } });
}

describe('CommentEditor', () => {
  it('Ctrl+Enter submits and clears', async () => {
    const { onSubmit, box } = setup();
    fireEvent.change(box, { target: { value: 'hello' } });
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('hello'));
    await waitFor(() => expect(box.value).toBe(''));
  });

  it('Enter alone does not submit; empty text never submits', () => {
    const { onSubmit, box } = setup();
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    fireEvent.change(box, { target: { value: 'x' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('keeps the text when the send fails', async () => {
    const { onSubmit, box } = setup(vi.fn<(text: string) => Promise<unknown>>(async () => Promise.reject(new Error('x'))));
    fireEvent.change(box, { target: { value: 'keep me' } });
    fireEvent.keyDown(box, { key: 'Enter', metaKey: true });
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(box.value).toBe('keep me');
  });

  it('@ opens the picker, filters, Enter inserts the token', () => {
    const { box } = setup();
    type(box, 'hi @');
    expect(screen.getAllByRole('option')).toHaveLength(2);
    type(box, 'hi @ma');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Malee']);
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(box.value).toBe('hi @[3] ');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('ArrowDown moves the highlighted option', () => {
    const { box } = setup();
    type(box, '@');
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(box.value).toBe('@[3] ');
  });

  it('Escape closes the picker only and keeps the text', () => {
    const { box } = setup();
    type(box, '@');
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(box.value).toBe('@');
  });

  it('is dirty while holding unsent text so Escape cancels before closing', () => {
    const { box } = setup();
    expect(box.getAttribute('data-dirty')).toBe('false');
    fireEvent.change(box, { target: { value: 'draft' } });
    expect(box.getAttribute('data-dirty')).toBe('true');
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(box.value).toBe('');
  });

  it('in edit mode Escape with changed text cancels the whole edit, not just the text', () => {
    const onCancel = vi.fn();
    render(
      <TrackingProvider lang="en">
        <CommentEditor members={members} onSubmit={async () => ({})} submitLabel="Save" initial="old" onCancel={onCancel} />
      </TrackingProvider>,
    );
    const box = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'changed' } });
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    box.dispatchEvent(esc);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('in edit mode the field is always dirty: the sheet swallows that Escape, the edit is cancelled', () => {
    const onCancel = vi.fn();
    render(
      <TrackingProvider lang="en">
        <CommentEditor members={members} onSubmit={async () => ({})} submitLabel="Save" initial="old" onCancel={onCancel} />
      </TrackingProvider>,
    );
    const box = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(box.getAttribute('data-dirty')).toBe('true');
    const ev = Object.defineProperty(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }), 'target', { value: box });
    inlineEscape(ev);
    expect(ev.defaultPrevented).toBe(true);
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
