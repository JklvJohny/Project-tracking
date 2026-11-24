'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '../shared/api/client';
import type { components } from '../shared/api/schema';

export type Dashboard = components['schemas']['Dashboard'];

export const dashboardKey = (projectId: number | null) => ['dashboard', projectId] as const;

export const useDashboard = (projectId: number | null) =>
  useQuery({
    queryKey: dashboardKey(projectId),
    queryFn: () => api<Dashboard>(projectId === null ? '/dashboard' : `/dashboard?projectId=${projectId}`),
  });
