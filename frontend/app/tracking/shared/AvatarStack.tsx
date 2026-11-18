'use client';
import { Avatar, AVATAR_SIZE, type AvatarSize, type AvatarUser } from './Avatar';

export function AvatarStack({ users, max = 4, size = 'sm' }: { users: AvatarUser[]; max?: number; size?: AvatarSize }) {
  const shown = users.slice(0, max);
  const rest = users.length - shown.length;
  return (
    <span className="flex -space-x-1.5">
      {shown.map((u) => (
        <Avatar key={u.id} user={u} size={size} />
      ))}
      {rest > 0 && (
        <span
          className={`inline-flex items-center justify-center rounded-full bg-muted font-semibold text-muted-foreground ring-2 ring-card ${AVATAR_SIZE[size]}`}
        >
          +{rest}
        </span>
      )}
    </span>
  );
}
