'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '../shared/api/client';
import type { components } from '../shared/api/schema';

export type PersonPage = components['schemas']['PersonPage'];

export const personKey = (userId: number) => ['person', userId] as const;

/** One person's page (GET /people/{id}): admins and PMs may read anyone's; the server answers 403 otherwise. */
export const usePerson = (userId: number, enabled = true) =>
  useQuery({
    queryKey: personKey(userId),
    queryFn: () => api<PersonPage>(`/people/${userId}`),
    enabled,
    // Assignments change on every board; the impact must use the current picture.
    staleTime: 0,
  });
