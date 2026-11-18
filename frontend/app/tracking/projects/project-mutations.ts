'use client';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '../shared/api/client';
import { qk } from '../shared/api/queries';
import type { components } from '../shared/api/schema';
import { dropMember, patchBoardProject, setMyRole, upsertMember, type BoardData } from '../board/board-cache';

type S = components['schemas'];

const membersKey = (projectId: number) => ['members', projectId] as const;

/** Writes the Project response into the list cache and, when loaded, the board's project block. */
export function patchProjectCaches(qc: QueryClient, p: S['Project']) {
  qc.setQueryData<S['Project'][]>(qk.projects, (old) => old?.map((x) => (x.id === p.id ? p : x)));
  qc.setQueryData<BoardData>(qk.board(p.id), (b) => (b ? patchBoardProject(b, p) : b));
}

/** A project the caller can no longer see (they removed themselves) leaves the projects list at once. */
export function dropProject(qc: QueryClient, projectId: number) {
  qc.setQueryData<S['Project'][]>(qk.projects, (old) => old?.filter((x) => x.id !== projectId));
}

function patchBoard(qc: QueryClient, projectId: number, fn: (b: BoardData) => BoardData) {
  qc.setQueryData<BoardData>(qk.board(projectId), (b) => (b ? fn(b) : b));
}

export function useUpdateProject(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: S['UpdateProjectInput']) =>
      api<S['Project']>(`/projects/${projectId}`, { method: 'PATCH', json: input satisfies S['UpdateProjectInput'] }),
    onSuccess: (p) => patchProjectCaches(qc, p),
  });
}

/** The same hook archives and restores (Undo), so both patch the caches identically. */
export function useArchiveProject(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (restore: boolean = false) =>
      api<S['Project']>(`/projects/${projectId}/${restore ? 'restore' : 'archive'}`, { method: 'POST' }),
    onSuccess: (p) => patchProjectCaches(qc, p),
  });
}

export function useMembers(projectId: number, enabled: boolean) {
  return useQuery({
    queryKey: membersKey(projectId),
    queryFn: () => api<S['Member'][]>(`/projects/${projectId}/members`),
    enabled,
  });
}

function useMemberWrites(projectId: number) {
  const qc = useQueryClient();
  return {
    put: (m: S['Member']) => {
      qc.setQueryData<S['Member'][]>(membersKey(projectId), (old) =>
        old?.some((x) => x.userId === m.userId) ? old.map((x) => (x.userId === m.userId ? m : x)) : [...(old ?? []), m],
      );
      patchBoard(qc, projectId, (b) => upsertMember(b, m));
    },
    drop: (userId: number) => {
      qc.setQueryData<S['Member'][]>(membersKey(projectId), (old) => old?.filter((x) => x.userId !== userId));
      patchBoard(qc, projectId, (b) => dropMember(b, userId));
    },
  };
}

export function useAddMember(projectId: number) {
  const w = useMemberWrites(projectId);
  return useMutation({
    mutationFn: (input: S['AddMemberInput']) =>
      api<S['Member']>(`/projects/${projectId}/members`, { method: 'POST', json: input satisfies S['AddMemberInput'] }),
    onSuccess: w.put,
  });
}

export function useSetRole(projectId: number) {
  const w = useMemberWrites(projectId);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: number; role: S['ProjectRole'] }) =>
      api<S['Member']>(`/projects/${projectId}/members/${userId}`, { method: 'PATCH', json: { role } satisfies S['SetRoleInput'] }),
    onSuccess: (m) => {
      w.put(m);
      // Demoting yourself must close the manage controls now, not after a refetch.
      if (m.userId === qc.getQueryData<S['Me']>(qk.me)?.user.id) patchBoard(qc, projectId, (b) => setMyRole(b, m.role));
    },
  });
}

export function useRemoveMember(projectId: number) {
  const w = useMemberWrites(projectId);
  return useMutation({
    mutationFn: (userId: number) => api<object>(`/projects/${projectId}/members/${userId}`, { method: 'DELETE' }),
    onSuccess: (_, userId) => w.drop(userId),
  });
}
