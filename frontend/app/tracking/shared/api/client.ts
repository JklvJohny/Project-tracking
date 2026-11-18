// Fetch wrapper for the tracking service. Paths are relative to the service base
// (e.g. api('/projects')). Host and dev both reach it through the same-origin
// /api/tracking rewrite, so no CORS and no absolute URLs.

export const API_BASE = '/api/tracking/v1';

export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
    // English text from the server (also the discriminator for conflict: "stale_order").
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type AuthHeaders = () => Record<string, string> | Promise<Record<string, string>>;
let getAuthHeaders: AuthHeaders | undefined;

export function configureApi(opts: { getAuthHeaders?: AuthHeaders }) {
  getAuthHeaders = opts.getAuthHeaders;
}

export type ApiInit = RequestInit & { json?: unknown };

async function authed(initHeaders?: HeadersInit): Promise<Headers> {
  const headers = new Headers(initHeaders);
  if (getAuthHeaders) {
    for (const [k, v] of Object.entries(await getAuthHeaders())) headers.set(k, v);
  }
  return headers;
}

/**
 * `json` bodies are JSON-encoded. For multipart uploads pass a FormData as `body` and no `json`: Content-Type is then
 * left unset so the browser adds the multipart boundary itself.
 */
export async function api<T>(path: string, init: ApiInit = {}): Promise<T> {
  const { json, headers: initHeaders, ...rest } = init;
  const headers = await authed(initHeaders);
  let body = rest.body;
  if (json !== undefined) {
    // Content-Type only when there is a body: a header on GET forces a CORS preflight.
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(json);
  }
  let res: Response;
  try {
    res = await fetch(API_BASE + path, {
      // 'no-cache' makes the browser revalidate with If-None-Match and hand us the
      // cached 200 on a 304, so the board ETag works without any manual cache here.
      cache: 'no-cache',
      credentials: 'same-origin',
      ...rest,
      headers,
      body,
    });
  } catch {
    throw new ApiError('network_error', 0, 'network error');
  }
  let payload:
    | { success?: boolean; data?: unknown; error?: string; code?: string; fields?: Record<string, string> }
    | undefined;
  try {
    payload = await res.json();
  } catch {
    payload = undefined;
  }
  if (!res.ok || !payload || payload.success === false) {
    throw new ApiError(payload?.code ?? 'server_error', res.status, payload?.error ?? res.statusText, payload?.fields);
  }
  return payload.data as T;
}

/**
 * Fetches a non-JSON resource (a PDF) with the same auth headers as api(). Needed because an iframe or <a download>
 * cannot send a custom header such as the dev shell's X-User-ID. Errors still arrive as the JSON envelope.
 */
export async function apiBlob(path: string, init: RequestInit = {}): Promise<Blob> {
  const headers = await authed(init.headers);
  let res: Response;
  try {
    res = await fetch(API_BASE + path, { cache: 'no-cache', credentials: 'same-origin', ...init, headers });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiError('network_error', 0, 'network error');
  }
  if (res.ok) return res.blob();
  let payload: { error?: string; code?: string } | undefined;
  try {
    payload = await res.json();
  } catch {
    payload = undefined;
  }
  throw new ApiError(payload?.code ?? 'server_error', res.status, payload?.error ?? res.statusText);
}
