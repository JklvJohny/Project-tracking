import { describe, expect, it } from 'vitest';
import { ApiError } from './api/client';
import { errorKey, errorText } from './errors';

const CODES = [
  'bad_request', 'unauthorized', 'forbidden', 'not_found', 'conflict', 'validation_failed', 'server_error',
  'network_error', 'stale_order', 'required', 'too_long', 'invalid', 'invalid_date', 'before_start', 'not_member',
];

describe('errorText', () => {
  it('has distinct text for every code in both languages', () => {
    for (const lang of ['th', 'en'] as const) {
      const seen = new Set(CODES.map((c) => errorText(c, lang)));
      expect(seen.size).toBe(CODES.length);
    }
  });
  it('falls back to server_error for unknown codes', () => {
    expect(errorText('???', 'en')).toBe(errorText('server_error', 'en'));
  });
  it('errorKey turns conflict + stale_order into stale_order only', () => {
    expect(errorKey(new ApiError('conflict', 409, 'stale_order'))).toBe('stale_order');
    expect(errorKey(new ApiError('conflict', 409, 'last pm'))).toBe('conflict');
    expect(errorKey(new Error('x'))).toBe('server_error');
  });
});
