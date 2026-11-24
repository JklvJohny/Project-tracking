'use client';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { components } from './schema';

type S = components['schemas'];

export const qk = {
  me: ['me'] as const,
  projects: ['projects'] as const,
  board: (id: number) => ['board', id] as const,
  archived: (id: number) => ['archived', id] as const,
  card: (id: number) => ['card', id] as const,
  comments: (id: number) => ['comments', id] as const,
  myTasks: ['my-tasks'] as const,
};

export const useMe = () => useQuery({ queryKey: qk.me, queryFn: () => api<S['Me']>('/me') });

// Cards change on other pages; always refetch on arrival instead of trusting a 15 s old copy.
export const useMyTasks = () => useQuery({ queryKey: qk.myTasks, queryFn: () => api<S['MyTasks']>('/me/tasks'), staleTime: 0 });

export const useProjects = () => useQuery({ queryKey: qk.projects, queryFn: () => api<S['ProjectListItem'][]>('/projects') });

// The browser revalidates this URL with If-None-Match (see api()), so a refetch of an unchanged board is a 304.
// A board left in a background tab goes stale while others work on it (drags would then fail with stale_order), so
// it reloads when the tab comes back, once it is older than staleTime. The server answers 304 when nothing changed.
export const useBoard = (projectId: number) =>
  useQuery({
    queryKey: qk.board(projectId),
    queryFn: () => api<S['Board']>(`/projects/${projectId}/board`),
    refetchOnWindowFocus: true,
  });

export const useCard = (cardId: number | undefined) =>
  useQuery({
    queryKey: qk.card(cardId ?? 0),
    queryFn: () => api<S['CardDetail']>(`/cards/${cardId}`),
    enabled: cardId !== undefined,
  });

export const useComments = (cardId: number | undefined) =>
  useQuery({
    queryKey: qk.comments(cardId ?? 0),
    queryFn: () => api<S['Comment'][]>(`/cards/${cardId}/comments`),
    enabled: cardId !== undefined,
  });

/** Warms the card detail on hover/focus so the panel opens without a spinner. Skipped while the cache is fresh. */
export const prefetchCard = (qc: QueryClient, cardId: number) =>
  qc.prefetchQuery({
    queryKey: qk.card(cardId),
    queryFn: () => api<S['CardDetail']>(`/cards/${cardId}`),
    staleTime: 30_000,
  });
