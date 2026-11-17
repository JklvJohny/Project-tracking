import { describe, expect, it } from 'vitest';
import { fmtDate, isOverdue, priorityLabel, todayIso } from './format';

describe('format', () => {
  it('fmtDate th uses Buddhist year', () => {
    expect(fmtDate('2026-11-17', 'th')).toContain('2569');
  });
  it('fmtDate en uses Gregorian year and does not shift the day', () => {
    expect(fmtDate('2026-11-17', 'en')).toBe('Nov 17, 2026');
  });
  it('isOverdue false when completed', () => {
    expect(isOverdue('2026-01-01', '2026-01-02T00:00:00Z', '2026-11-17')).toBe(false);
  });
  it('isOverdue true when due before today and open; false on due day or no due', () => {
    expect(isOverdue('2026-11-16', null, '2026-11-17')).toBe(true);
    expect(isOverdue('2026-11-17', null, '2026-11-17')).toBe(false);
    expect(isOverdue(null, null, '2026-11-17')).toBe(false);
  });
  it('todayIso pads local date', () => {
    expect(todayIso(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
  it('priorityLabel is localised', () => {
    expect(priorityLabel('urgent', 'en')).toBe('Urgent');
    expect(priorityLabel('urgent', 'th')).toBe('เร่งด่วน');
  });
});
