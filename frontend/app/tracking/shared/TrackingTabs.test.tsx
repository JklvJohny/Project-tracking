import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TrackingContext } from './i18n';
import { TrackingTabs } from './TrackingTabs';

let pathname = '/tracking';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

afterEach(cleanup);

function renderTabs(lang: 'th' | 'en') {
  render(
    <TrackingContext.Provider value={{ lang, setLang: () => {}, theme: 'light', setTheme: () => {}, resolvedTheme: 'light' }}>
      <TrackingTabs />
    </TrackingContext.Provider>,
  );
}

describe('TrackingTabs', () => {
  it('Dashboard and Import are disabled, not links, and carry the coming-soon tag', () => {
    renderTabs('en');
    for (const name of ['Dashboard', 'Import']) {
      const el = screen.getByText(name).closest('[aria-disabled]')!;
      expect(el.getAttribute('aria-disabled')).toBe('true');
      expect(el.closest('a')).toBeNull();
      expect(el.textContent).toContain('Soon');
    }
  });

  it('Projects and Reports are links; the current one has aria-current', () => {
    renderTabs('en');
    const projects = screen.getByRole('link', { name: 'Projects' });
    expect(projects.getAttribute('href')).toBe('/tracking');
    expect(projects.getAttribute('aria-current')).toBe('page');
    const reports = screen.getByRole('link', { name: 'Reports' });
    expect(reports.getAttribute('href')).toBe('/tracking/reports');
    expect(reports.getAttribute('aria-current')).toBeNull();
  });

  it('marks Reports current on its route and translates the tag', () => {
    pathname = '/tracking/reports';
    renderTabs('th');
    expect(screen.getByRole('link', { name: 'รายงาน' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'โปรเจกต์' }).getAttribute('aria-current')).toBeNull();
    expect(screen.getAllByText('เร็ว ๆ นี้').length).toBe(2);
    pathname = '/tracking';
  });
});
