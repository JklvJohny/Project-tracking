import { describe, expect, it } from 'vitest';
import { canTickCard } from './access';

const live = (myRole: string) => ({ myRole, project: { archivedAt: null } }) as never;
const archived = (myRole: string) => ({ myRole, project: { archivedAt: '2026-11-19T00:00:00Z' } }) as never;

describe('canTickCard', () => {
  it('admin and PM tick any card', () => {
    expect(canTickCard(live('admin'), [], 9)).toBe(true);
    expect(canTickCard(live('pm'), [], 9)).toBe(true);
  });
  it('a member ticks only cards assigned to them', () => {
    expect(canTickCard(live('member'), [3, 9], 9)).toBe(true);
    expect(canTickCard(live('member'), [3], 9)).toBe(false);
    expect(canTickCard(live('member'), [9], undefined)).toBe(false);
  });
  it('nobody ticks on an archived project', () => {
    expect(canTickCard(archived('pm'), [], 9)).toBe(false);
    expect(canTickCard(archived('member'), [9], 9)).toBe(false);
  });
});
