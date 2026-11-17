import { describe, expect, it } from 'vitest';
import { announcements } from './announcements';

const ev = { active: { id: 'card:5' }, over: { id: 'card:6' } } as never;

describe('announcements', () => {
  it('th contains Thai text', () => {
    expect(announcements('th').onDragStart?.({ active: { id: 'card:5' } } as never)).toMatch(/[\u0E00-\u0E7F]/);
    expect(announcements('th').onDragEnd?.(ev)).toMatch(/[\u0E00-\u0E7F]/);
  });
  it('en is English', () => {
    expect(announcements('en').onDragEnd?.(ev)).toMatch(/dropped/i);
  });
});
