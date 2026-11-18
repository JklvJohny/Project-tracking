import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useLang, useT } from './i18n';
import { TrackingProvider } from './provider';

const TEXT = { th: { hello: 'สวัสดี' }, en: { hello: 'Hello' } };

function Probe() {
  const t = useT(TEXT);
  const { setLang } = useLang();
  return <button onClick={() => setLang('en')}>{t.hello}</button>;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('i18n', () => {
  it('useT switches TEXT when setLang("en")', async () => {
    render(
      <TrackingProvider>
        <Probe />
      </TrackingProvider>,
    );
    expect(screen.getByRole('button').textContent).toBe('สวัสดี');
    await act(async () => screen.getByRole('button').click());
    expect(screen.getByRole('button').textContent).toBe('Hello');
    expect(localStorage.getItem('pt-lang')).toBe('en');
  });

  it('a lang prop controls the language and wins over storage', () => {
    localStorage.setItem('pt-lang', 'th');
    render(
      <TrackingProvider lang="en">
        <Probe />
      </TrackingProvider>,
    );
    expect(screen.getByRole('button').textContent).toBe('Hello');
  });
});
