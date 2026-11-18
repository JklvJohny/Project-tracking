'use client';
// Colour comes from the --av-* tokens in tracking.css, indexed by user id so a person keeps one colour everywhere.
export const AVATAR_COLORS = 6;

export type AvatarUser = { id: number; name: string; avatarUrl?: string | null };
export type AvatarSize = 'xs' | 'sm' | 'md';

export const AVATAR_SIZE: Record<AvatarSize, string> = {
  xs: 'h-5 w-5 text-[9px]',
  sm: 'h-6 w-6 text-[10px]',
  md: 'h-8 w-8 text-[11px]',
};

export const avatarColorIndex = (id: number) => Math.abs(id) % AVATAR_COLORS;

// First letters of the first two words; Array.from keeps Thai/emoji code points whole.
export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => Array.from(w)[0] ?? '')
    .join('')
    .toUpperCase();
}

export function Avatar({ user, size = 'sm' }: { user: AvatarUser; size?: AvatarSize }) {
  return (
    <span
      title={user.name}
      style={{ backgroundColor: `var(--av-${avatarColorIndex(user.id)})` }}
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ring-2 ring-card ${AVATAR_SIZE[size]}`}
    >
      <span aria-hidden="true">{initials(user.name)}</span>
      <span className="sr-only">{user.name}</span>
    </span>
  );
}
