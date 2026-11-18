import { describe, expect, it } from 'vitest';

// Thai time (UTC+7) is where a UTC calendar shows yesterday: set before format.ts builds its formatters.
process.env.TZ = 'Asia/Bangkok';
const { fmtDate } = await import('./format');

describe('fmtDate time zones', () => {
  it('a timestamp is shown in the local time zone', () => {
    // 01:30 on Nov 18 in Bangkok is still Nov 17 in UTC.
    expect(fmtDate('2026-11-17T18:30:00Z', 'en')).toBe('Nov 18, 2026');
  });
  it('a plain date never shifts a day', () => {
    expect(fmtDate('2026-11-17', 'en')).toBe('Nov 17, 2026');
  });
});
