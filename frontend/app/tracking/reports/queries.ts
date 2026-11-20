'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../shared/api/client';
import type { components } from '../shared/api/schema';
import { errorMessage } from '../shared/errors';
import { useLang, useT } from '../shared/i18n';

type S = components['schemas'];
export type Doc = S['Document'];
export type Folder = S['Folder'];
export type Share = S['FolderShare'];

export const MAX_BYTES = 20 * 1024 * 1024;

export const dk = {
  docs: (projectId: number) => ['documents', projectId] as const,
  folders: ['report-folders'] as const,
  shares: (projectId: number) => ['folder-shares', projectId] as const,
};

/** The folders this person may open: their projects', and those shared with them (every one for an admin). */
export const useFolders = () => useQuery({ queryKey: dk.folders, queryFn: () => api<Folder[]>('/report-folders') });

export const useShares = (projectId: number, enabled: boolean) =>
  useQuery({ queryKey: dk.shares(projectId), queryFn: () => api<Share[]>(`/projects/${projectId}/folder-shares`), enabled });

export function useShare(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: number) => api<Share>(`/projects/${projectId}/folder-shares/${userId}`, { method: 'PUT' }),
    onSuccess: (sh) =>
      qc.setQueryData<Share[]>(dk.shares(projectId), (old) => (old?.some((x) => x.userId === sh.userId) ? old : [...(old ?? []), sh])),
  });
}

export function useUnshare(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: number) => api<unknown>(`/projects/${projectId}/folder-shares/${userId}`, { method: 'DELETE' }),
    onSuccess: (_, userId) => qc.setQueryData<Share[]>(dk.shares(projectId), (old) => old?.filter((x) => x.userId !== userId)),
  });
}

const fetchDocs = (projectId: number) => api<Doc[]>(`/projects/${projectId}/documents`);

export const useDocuments = (projectId: number) =>
  useQuery({ queryKey: dk.docs(projectId), queryFn: () => fetchDocs(projectId) });

/**
 * An opened folder's live count: this subscribes to the cache only (enabled: false), so the sidebar follows uploads
 * and deletes without a request. Folders not yet opened use Folder.documentCount.
 */
export const useCachedDocCount = (projectId: number) =>
  useQuery({ queryKey: dk.docs(projectId), queryFn: () => fetchDocs(projectId), enabled: false }).data?.length;

const TEXT = {
  th: { deleted: 'ลบเอกสารแล้ว', undo: 'เลิกทำ' },
  en: { deleted: 'Document deleted', undo: 'Undo' },
};

export function useUploadDocument(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      // Multipart: api() leaves Content-Type to the browser. fetch has no upload progress events, so the UI shows
      // a busy state for the request instead of a percentage.
      const body = new FormData();
      body.append('file', file);
      return api<Doc>(`/projects/${projectId}/documents`, { method: 'POST', body });
    },
    onSuccess: (d) => qc.setQueryData<Doc[]>(dk.docs(projectId), (old) => [d, ...(old ?? [])]),
  });
}

export function useDeleteDocument(projectId: number) {
  const qc = useQueryClient();
  const { lang } = useLang();
  const t = useT(TEXT);
  const restore = useMutation({
    mutationFn: (id: number) => api<unknown>(`/documents/${id}/restore`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: dk.docs(projectId) }),
    onError: (e) => toast.error(errorMessage(e, lang)),
  });
  return useMutation({
    mutationFn: (d: Doc) => api<unknown>(`/documents/${d.id}`, { method: 'DELETE' }),
    onSuccess: (_, d) => {
      qc.setQueryData<Doc[]>(dk.docs(projectId), (old) => old?.filter((x) => x.id !== d.id));
      toast(t.deleted, { action: { label: t.undo, onClick: () => restore.mutate(d.id) } });
    },
    onError: (e) => toast.error(errorMessage(e, lang)),
  });
}
