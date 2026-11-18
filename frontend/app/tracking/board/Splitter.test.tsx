import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TrackingProvider } from '../shared/provider';
import { Splitter, useSplit } from './Splitter';

function Harness() {
  const [ratio, setRatio] = useSplit();
  return <Splitter value={ratio} onChange={setRatio} containerRef={createRef<HTMLDivElement>()} />;
}
const mount = () =>
  render(
    <TrackingProvider lang="en">
      <Harness />
    </TrackingProvider>,
  );
beforeEach(() => localStorage.clear());
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
});
