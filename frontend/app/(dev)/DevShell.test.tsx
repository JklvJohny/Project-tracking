import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const USER = /ผู้ใช้ \(dev\)|User \(dev\)/;

// SHOW_USERS is read at module load, so each test imports DevShell after stubbing the env.
async function renderShell(env: string) {
  vi.stubEnv('NEXT_PUBLIC_ENV', env);
  vi.resetModules();
  const { DevShell } = await import('./DevShell');
  render(
    <DevShell>
      <p>page</p>
    </DevShell>,
  );
}

const press = (opts: { alt?: boolean }) =>
  act(() => {
    fireEvent.keyDown(window, { code: 'KeyB', key: 'B', ctrlKey: true, shiftKey: true, altKey: !!opts.alt });
  });

describe('DevShell dev mode shortcuts', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it('hides the dev tools until Ctrl+Shift+B, and Ctrl+Alt+Shift+B hides them again', async () => {
    await renderShell('local');
    expect(screen.queryByText(USER)).toBeNull();

    press({});
    expect(screen.getByText(USER)).toBeTruthy();

    press({ alt: true });
    expect(screen.queryByText(USER)).toBeNull();
  });

  it('remembers dev mode across reloads', async () => {
    await renderShell('local');
    press({});
    cleanup();

    await renderShell('local');
    expect(await screen.findByText(USER)).toBeTruthy();
  });

  it('ignores the shortcut in a non-local build', async () => {
    await renderShell('');
    press({});
    expect(screen.queryByText(USER)).toBeNull();
  });

  it('keeps sending the chosen dev user while the tools are hidden', async () => {
    sessionStorage.setItem('pt-dev-user', '6');
    vi.stubEnv('NEXT_PUBLIC_ENV', 'local');
    vi.resetModules();
    const client = await import('../tracking/shared/api/client');
    // A new Response per call: a body reads once, and the account menu fetches /me too.
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ success: true, data: {} })));
    vi.stubGlobal('fetch', fetchMock);
    const { DevShell } = await import('./DevShell');
    render(
      <DevShell>
        <p>page</p>
      </DevShell>,
    );
    await client.api('/me');
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(headers.get('X-User-ID')).toBe('6');
    vi.unstubAllGlobals();
  });
});
