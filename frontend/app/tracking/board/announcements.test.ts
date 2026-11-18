import { describe, expect, it } from 'vitest';
import { announcements } from './announcements';

const ev = { active: { id: 'card:5' }, over: { id: 'card:6' } } as never;

describe('announcements', () => {
  it('th contains Thai text', () => {
    expect(announcements('th').onDragStart?.({ active: { id: 'card:5' } } as never)).toMatch(/[\u0E00-\u0E7F]/);
    expect(announcements('th').onDragEnd?.(ev)).toMatch(/[\u0E00-\u0E7F]/);
  });
  it('th separates a Latin card name from the Thai words around it', () => {
    const name = () => 'Bravo';
    expect(announcements('th', name).onDragEnd?.(ev)).toBe('วางการ์ด Bravo ที่ การ์ด Bravo แล้ว');
  });
  it('en is English', () => {
    expect(announcements('en').onDragEnd?.(ev)).toMatch(/dropped/i);
  });
});
