import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, apiBlob, configureApi } from './client';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  configureApi({});
});
afterEach(() => vi.unstubAllGlobals());

describe('api', () => {
  it('unwraps data', async () => {
    fetchMock.mockResolvedValue(json({ success: true, data: { id: 1 } }));
    await expect(api('/me')).resolves.toEqual({ id: 1 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/tracking/v1/me');
    expect(init.credentials).toBe('same-origin');
    expect(new Headers(init.headers).has('Content-Type')).toBe(false);
  });

  it('sends json bodies with a content type', async () => {
    fetchMock.mockResolvedValue(json({ success: true, data: {} }));
    await api('/projects', { method: 'POST', json: { name: 'x' } });
    const init = fetchMock.mock.calls[0][1];
    expect(init.body).toBe('{"name":"x"}');
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
  });

  it('throws ApiError with code and fields on 422', async () => {
    fetchMock.mockResolvedValue(
      json({ success: false, error: 'bad', code: 'validation_failed', fields: { name: 'required' } }, 422),
    );
    const err = await api('/projects', { method: 'POST', json: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: 'validation_failed', status: 422, fields: { name: 'required' } });
  });

  it('keeps the error text so stale_order can be told from other conflicts', async () => {
    fetchMock.mockResolvedValue(json({ success: false, error: 'stale_order', code: 'conflict' }, 409));
    const err = await api('/cards/1/move', { method: 'POST', json: {} }).catch((e) => e);
    expect(err).toMatchObject({ code: 'conflict', message: 'stale_order', status: 409 });
  });

  it('maps fetch rejection to network_error', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(api('/me')).rejects.toMatchObject({ code: 'network_error', status: 0 });
  });

  it('maps a non-envelope failure to server_error', async () => {
    fetchMock.mockResolvedValue(new Response('<html>', { status: 502 }));
    await expect(api('/me')).rejects.toMatchObject({ code: 'server_error', status: 502 });
  });

  it('sends getAuthHeaders headers', async () => {
    fetchMock.mockResolvedValue(json({ success: true, data: null }));
    configureApi({ getAuthHeaders: () => ({ 'X-User-ID': '3' }) });
    await api('/me');
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('X-User-ID')).toBe('3');
  });
});

describe('multipart and blobs', () => {
  it('passes a FormData body through without a Content-Type', async () => {
    fetchMock.mockResolvedValue(json({ success: true, data: { id: 1 } }));
    const fd = new FormData();
    fd.append('file', new File(['%PDF-'], 'a.pdf'));
    await api('/projects/1/documents', { method: 'POST', body: fd });
    const init = fetchMock.mock.calls[0][1];
    expect(init.body).toBe(fd);
    expect(new Headers(init.headers).has('Content-Type')).toBe(false);
  });

  it('apiBlob sends auth headers and returns the blob', async () => {
    configureApi({ getAuthHeaders: () => ({ 'X-User-ID': '7' }) });
    fetchMock.mockResolvedValue(new Response('%PDF-1', { status: 200 }));
    const blob = await apiBlob('/documents/3/file');
    expect(await blob.text()).toBe('%PDF-1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/tracking/v1/documents/3/file');
    expect(new Headers(init.headers).get('X-User-ID')).toBe('7');
  });

  it('apiBlob throws ApiError from the JSON envelope', async () => {
    fetchMock.mockResolvedValue(json({ success: false, error: 'nope', code: 'not_found' }, 404));
    await expect(apiBlob('/documents/9/file')).rejects.toMatchObject({ code: 'not_found', status: 404 });
  });
});
