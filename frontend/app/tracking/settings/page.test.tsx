import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TrackingProvider } from '../shared/provider';
import SettingsPage from './page';

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('dark');
  delete document.documentElement.dataset.ptDark;
});

describe('Settings', () => {
  it('slate is the default dark palette and is set on <html>', () => {
    render(
      <TrackingProvider lang="en">
        <SettingsPage />
      </TrackingProvider>,
    );
    expect((screen.getByRole('radio', { name: /^Slate/ }) as HTMLInputElement).checked).toBe(true);
    expect(document.documentElement.dataset.ptDark).toBe('slate');
  });

  it('picking a palette applies it at once and remembers it', () => {
    render(
      <TrackingProvider lang="en">
        <SettingsPage />
      </TrackingProvider>,
    );
    fireEvent.click(screen.getByRole('radio', { name: /^Warm grey/ }));
    expect(document.documentElement.dataset.ptDark).toBe('warm');
    expect(localStorage.getItem('pt-dark-palette')).toBe('warm');
    expect((screen.getByRole('radio', { name: /^Warm grey/ }) as HTMLInputElement).checked).toBe(true);
  });

  it('offers seven palettes, each with a name and a description', () => {
    render(
      <TrackingProvider lang="en">
        <SettingsPage />
      </TrackingProvider>,
    );
    const names = ['Slate', 'Graphite', 'Warm grey', 'Navy', 'Ocean', 'Forest', 'Plum'];
    for (const n of names) expect(screen.getByRole('radio', { name: new RegExp(`^${n}`) })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /^Plum/ }));
    expect(document.documentElement.dataset.ptDark).toBe('plum');
    expect(localStorage.getItem('pt-dark-palette')).toBe('plum');
  });

  it('a stored palette is read back; an unknown one falls back to slate', () => {
    localStorage.setItem('pt-dark-palette', 'navy');
    const { unmount } = render(
      <TrackingProvider lang="en">
        <SettingsPage />
      </TrackingProvider>,
    );
    expect(document.documentElement.dataset.ptDark).toBe('navy');
    unmount();
    localStorage.setItem('pt-dark-palette', 'black');
    render(
      <TrackingProvider lang="en">
        <SettingsPage />
      </TrackingProvider>,
    );
    expect(document.documentElement.dataset.ptDark).toBe('slate');
  });

  it('the theme radios switch the theme; in light mode the palette note says when it shows', () => {
    render(
      <TrackingProvider lang="th">
        <SettingsPage />
      </TrackingProvider>,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'สว่าง' }));
    expect(screen.getByText(/ตอนนี้ใช้ธีมสว่างอยู่/)).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'มืด' }));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('pt-theme')).toBe('dark');
    expect(screen.getByText('ใช้เมื่อธีมเป็นโหมดมืด')).toBeTruthy();
  });
});
