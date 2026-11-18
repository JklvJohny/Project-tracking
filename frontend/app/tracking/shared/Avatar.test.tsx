import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Avatar, AVATAR_COLORS, avatarColorIndex, initials } from './Avatar';
import { AvatarStack } from './AvatarStack';

afterEach(cleanup);

const css = readFileSync(join(__dirname, '..', 'tracking.css'), 'utf8');

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  return css.slice(start, css.indexOf('\n}', start));
}

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const whiteContrast = (hex: string) => 1.05 / (lum(hex) + 0.05);

describe('Avatar', () => {
  it('picks the same colour for the same id and spreads ids over the palette', () => {
    expect(avatarColorIndex(7)).toBe(avatarColorIndex(7));
    expect(avatarColorIndex(7)).toBe(7 % AVATAR_COLORS);
    expect(new Set([1, 2, 3, 4, 5, 6].map(avatarColorIndex)).size).toBe(AVATAR_COLORS);
  });

  it('shows initials and exposes the name', () => {
    render(<Avatar user={{ id: 2, name: 'Napat K.' }} />);
    expect(screen.getByText('NK')).toBeTruthy();
    expect(screen.getByTitle('Napat K.')).toBeTruthy();
    expect(initials('สมชาย ใจดี')).toBe('สใ');
    expect(initials('mali')).toBe('M');
  });

  it('white initials reach WCAG AA (4.5:1) on every palette colour, light and dark', () => {
    for (const sel of [':root', '.dark']) {
      const b = block(sel);
      for (let i = 0; i < AVATAR_COLORS; i++) {
        const hex = new RegExp(`--av-${i}:\\s*(#[0-9a-fA-F]{6})`).exec(b)?.[1];
        expect(hex, `${sel} --av-${i}`).toBeTruthy();
        expect(whiteContrast(hex!), `${sel} --av-${i} ${hex}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe('AvatarStack', () => {
  it('shows max avatars and a +N overflow', () => {
    const users = [1, 2, 3, 4, 5, 6].map((id) => ({ id, name: `User ${id}` }));
    render(<AvatarStack users={users} max={4} />);
    expect(screen.getAllByTitle(/^User /)).toHaveLength(4);
    expect(screen.getByText('+2')).toBeTruthy();
  });
});
