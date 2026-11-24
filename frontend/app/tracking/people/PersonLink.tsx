'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useMe } from '../shared/api/queries';
import { routes } from '../shared/routes';

/**
 * A name or picture that opens the person's page: your own goes to your profile; anyone else's only for admins and
 * PMs (the server refuses others, so for them it stays plain). `decorative` is for a second link to the same place
 * (a picture beside the name): it is skipped by the keyboard and screen readers.
 */
export function PersonLink({
  userId,
  children,
  className = '',
  decorative = false,
}: {
  userId: number;
  children: ReactNode;
  className?: string;
  decorative?: boolean;
}) {
  const me = useMe();
  const own = me.data?.user?.id === userId;
  if (!own && me.data?.canViewPeople !== true) return <span className={className}>{children}</span>;
  return (
    <Link
      href={own ? routes.profile : routes.person(userId)}
      aria-hidden={decorative || undefined}
      tabIndex={decorative ? -1 : undefined}
      className={`rounded hover:underline focus-visible:outline-2 focus-visible:outline-ring ${className}`}
    >
      {children}
    </Link>
  );
}
