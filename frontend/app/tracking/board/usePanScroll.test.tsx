import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { usePanScroll } from './usePanScroll';

function Scroller() {
  const pan = usePanScroll();
  return (
    <div data-testid="scroller" {...pan}>
      <button type="button">card</button>
      <ol data-testid="list" style={{ overflowY: 'auto' }}>
        <li>item</li>
      </ol>
    </div>
  );
}

// jsdom has no layout: give the scroller an overflowing width and a no-op pointer capture.
function mount() {
  render(<Scroller />);
  const el = screen.getByTestId('scroller');
  Object.defineProperty(el, 'scrollWidth', { value: 2000 });
  Object.defineProperty(el, 'clientWidth', { value: 800 });
  el.setPointerCapture = () => {};
  el.releasePointerCapture = () => {};
  el.scrollLeft = 100;
  return el;
}
afterEach(cleanup);

describe('usePanScroll', () => {
  it('dragging empty board space with the mouse scrolls sideways, opposite to the pointer', () => {
    const el = mount();
    fireEvent.pointerDown(el, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 500 });
    expect(el.dataset.panning).toBe('true');
    fireEvent.pointerMove(el, { pointerId: 1, pointerType: 'mouse', clientX: 380 });
    expect(el.scrollLeft).toBe(220);
    fireEvent.pointerUp(el, { pointerId: 1, pointerType: 'mouse' });
    expect(el.dataset.panning).toBeUndefined();
    fireEvent.pointerMove(el, { pointerId: 1, pointerType: 'mouse', clientX: 0 });
    expect(el.scrollLeft).toBe(220);
  });

  it('presses on a card or control, touch, and right-click do not pan', () => {
    const el = mount();
    fireEvent.pointerDown(screen.getByRole('button'), { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 500 });
    fireEvent.pointerMove(el, { pointerId: 1, pointerType: 'mouse', clientX: 300 });
    fireEvent.pointerDown(el, { pointerId: 2, pointerType: 'touch', button: 0, clientX: 500 });
    fireEvent.pointerMove(el, { pointerId: 2, pointerType: 'touch', clientX: 300 });
    fireEvent.pointerDown(el, { pointerId: 3, pointerType: 'mouse', button: 2, clientX: 500 });
    fireEvent.pointerMove(el, { pointerId: 3, pointerType: 'mouse', clientX: 300 });
    expect(el.scrollLeft).toBe(100);
  });

  it('a vertical wheel scrolls sideways, but not over a list that scrolls on its own', () => {
    const el = mount();
    fireEvent.wheel(el, { deltaY: 120 });
    expect(el.scrollLeft).toBe(220);
    const list = screen.getByTestId('list');
    Object.defineProperty(list, 'scrollHeight', { value: 900 });
    Object.defineProperty(list, 'clientHeight', { value: 300 });
    fireEvent.wheel(list, { deltaY: 120 });
    expect(el.scrollLeft).toBe(220);
  });

  it('leaves Shift+wheel, Ctrl+wheel (zoom) and trackpad sideways swipes to the browser', () => {
    const el = mount();
    fireEvent.wheel(el, { deltaY: 120, shiftKey: true });
    fireEvent.wheel(el, { deltaY: 120, ctrlKey: true });
    fireEvent.wheel(el, { deltaX: 80, deltaY: 10 });
    expect(el.scrollLeft).toBe(100);
  });
});
