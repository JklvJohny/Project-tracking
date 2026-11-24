'use client';
import { PersonLink } from '../people/PersonLink';
import { Avatar, AVATAR_SIZE, type AvatarSize, type AvatarUser } from './Avatar';

/** Overlapping pictures; with `link`, each one opens that person's page (where the viewer may see it). */
export function AvatarStack({
  users,
  max = 4,
  size = 'sm',
  link = false,
}: {
  users: AvatarUser[];
  max?: number;
  size?: AvatarSize;
  link?: boolean;
}) {
  const shown = users.slice(0, max);
  const rest = users.length - shown.length;
  return (
    <span className="flex -space-x-1.5">
      {shown.map((u) =>
        link ? (
          <PersonLink key={u.id} userId={u.id} className="inline-flex rounded-full">
            <Avatar user={u} size={size} />
          </PersonLink>
        ) : (
          <Avatar key={u.id} user={u} size={size} />
        ),
      )}
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
