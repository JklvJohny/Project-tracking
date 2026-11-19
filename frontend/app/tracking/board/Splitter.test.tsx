import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TrackingProvider } from '../shared/provider';
import { Splitter, useSplit } from './Splitter';

const onCollapse = vi.fn();
function Harness({ box }: { box?: HTMLDivElement }) {
  const [ratio, setRatio] = useSplit();
  return <Splitter value={ratio} onChange={setRatio} onCollapse={onCollapse} containerRef={{ current: box ?? null }} />;
}
const mount = (box?: HTMLDivElement) =>
  render(
    <TrackingProvider lang="en">
      <Harness box={box} />
    </TrackingProvider>,
  );
// A 1000px-tall container at the top of the page, so clientY maps straight to the ratio.
function fakeBox() {
  const el = document.createElement('div');
  el.getBoundingClientRect = () => ({ top: 0, height: 1000, left: 0, width: 800, right: 800, bottom: 1000, x: 0, y: 0, toJSON: () => ({}) });
  return el;
}
// jsdom has no pointer capture; pretend the handle captured the pointer on pointerdown.
function drag(s: HTMLElement, clientY: number) {
  s.hasPointerCapture = () => true;
  s.setPointerCapture = () => {};
  s.releasePointerCapture = () => {};
  fireEvent.pointerDown(s, { pointerId: 1, clientY: 550 });
  fireEvent.pointerMove(s, { pointerId: 1, clientY });
}
beforeEach(() => {
  localStorage.clear();
  onCollapse.mockClear();
});
afterEach(cleanup);

describe('Splitter', () => {
  it('is a separator whose value starts at the default', () => {
    mount();
    const s = screen.getByRole('separator');
    expect(s.getAttribute('aria-valuenow')).toBe('55');
  });
  it('arrow keys move by 5% and persist', () => {
    mount();
    const s = screen.getByRole('separator');
    fireEvent.keyDown(s, { key: 'ArrowDown' });
    expect(s.getAttribute('aria-valuenow')).toBe('60');
    expect(localStorage.getItem('pt-split')).toBe('0.6');
    fireEvent.keyDown(s, { key: 'ArrowUp' });
    fireEvent.keyDown(s, { key: 'ArrowUp' });
    expect(s.getAttribute('aria-valuenow')).toBe('50');
  });
  it('clamps to 20-80%', () => {
    mount();
    const s = screen.getByRole('separator');
    for (let i = 0; i < 12; i++) fireEvent.keyDown(s, { key: 'ArrowUp' });
    expect(s.getAttribute('aria-valuenow')).toBe('20');
    for (let i = 0; i < 20; i++) fireEvent.keyDown(s, { key: 'ArrowDown' });
    expect(s.getAttribute('aria-valuenow')).toBe('80');
  });
  it('restores the saved ratio and ignores junk', () => {
    localStorage.setItem('pt-split', '0.3');
    mount();
    expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe('30');
    cleanup();
    localStorage.setItem('pt-split', 'abc');
    mount();
    expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe('55');
  });
  it('dragging to the top edge collapses the Board and keeps the stored split', () => {
    localStorage.setItem('pt-split', '0.4');
    mount(fakeBox());
    drag(screen.getByRole('separator'), 30);
    expect(onCollapse).toHaveBeenCalledWith('board');
    expect(localStorage.getItem('pt-split')).toBe('0.4');
  });
  it('dragging to the bottom edge collapses the Timeline', () => {
    mount(fakeBox());
    drag(screen.getByRole('separator'), 970);
    expect(onCollapse).toHaveBeenCalledWith('timeline');
  });
  it('a drag inside the range only resizes', () => {
    mount(fakeBox());
    const s = screen.getByRole('separator');
    drag(s, 300);
    expect(onCollapse).not.toHaveBeenCalled();
    expect(s.getAttribute('aria-valuenow')).toBe('30');
  });
  it('ArrowUp at the minimum collapses the Board; ArrowDown at the maximum collapses the Timeline', () => {
    localStorage.setItem('pt-split', '0.2');
    mount();
    const s = screen.getByRole('separator');
    fireEvent.keyDown(s, { key: 'ArrowUp' });
    expect(onCollapse).toHaveBeenLastCalledWith('board');
    cleanup();
    localStorage.setItem('pt-split', '0.8');
    mount();
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowDown' });
    expect(onCollapse).toHaveBeenLastCalledWith('timeline');
  });
});
