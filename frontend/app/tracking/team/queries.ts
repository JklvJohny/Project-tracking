'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../shared/api/client';
import type { components } from '../shared/api/schema';
import { errorMessage } from '../shared/errors';
import { useLang } from '../shared/i18n';

type S = components['schemas'];
export type Team = S['Team'];
export type Person = S['TeamPerson'];

export const teamKey = ['team'] as const;

// Mirrors the server's limits (internal/team) to save a round trip; the server checks again.
export const MAX_SKILLS = 30;
export const MAX_SKILL = 40;

export const useTeam = () =>
  // Workload changes on other pages; refetch on arrival rather than trust an old copy.
  useQuery({ queryKey: teamKey, queryFn: () => api<Team>('/team'), staleTime: 0 });

/** Trim, squeeze inner spaces, drop blanks and case-insensitive duplicates (first spelling wins), as the server does. */
export function cleanSkills(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of raw) {
    const v = s.trim().split(/\s+/).join(' ');
    const key = v.toLocaleLowerCase();
    if (!v || seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

/** Saves one person's skills. Optimistic: the card changes at once and reverts with an error toast on failure. */
export function useSetSkills() {
  const qc = useQueryClient();
  const { lang } = useLang();
  return useMutation({
    mutationFn: ({ userId, skills }: { userId: number; skills: string[] }) =>
      api<{ skills: string[] }>(`/team/${userId}/skills`, { method: 'PUT', json: { skills } }),
    onMutate: async ({ userId, skills }) => {
      await qc.cancelQueries({ queryKey: teamKey });
      const before = qc.getQueryData<Team>(teamKey);
      qc.setQueryData<Team>(teamKey, (old) =>
        old && { ...old, people: old.people.map((p) => (p.userId === userId ? { ...p, skills } : p)) },
      );
      return { before };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.before) qc.setQueryData(teamKey, ctx.before);
      toast.error(errorMessage(e, lang));
    },
    onSuccess: ({ skills }, { userId }) =>
      qc.setQueryData<Team>(teamKey, (old) =>
        old && { ...old, people: old.people.map((p) => (p.userId === userId ? { ...p, skills } : p)) },
      ),
  });
}

export type TeamFilter = { q: string; skills: string[] };

/** A person matches when the text is in their name or a skill, and they have every chosen skill. */
export function matchesTeam(p: Person, f: TeamFilter): boolean {
  const q = f.q.trim().toLocaleLowerCase();
  const mine = p.skills.map((s) => s.toLocaleLowerCase());
  if (q && !p.name.toLocaleLowerCase().includes(q) && !mine.some((s) => s.includes(q))) return false;
  return f.skills.every((s) => mine.includes(s.toLocaleLowerCase()));
}

/**
 * Every skill in the team, most common first, then by name; the first spelling seen is shown. Named skills nobody has
 * yet (the catalog) come last with count 0.
 */
export function allSkills(people: Person[], catalog: string[] = []): { name: string; count: number }[] {
  const by = new Map<string, { name: string; count: number }>();
  for (const s of catalog) by.set(s.toLocaleLowerCase(), { name: s, count: 0 });
  for (const p of people)
    for (const s of p.skills) {
      const k = s.toLocaleLowerCase();
      const e = by.get(k);
      if (e) e.count++;
      else by.set(k, { name: s, count: 1 });
    }
  return [...by.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Names a skill for the department and gives it to the chosen people; the server answers with the whole Team view. */
export function useAddSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, userIds }: { name: string; userIds: number[] }) =>
      api<Team>('/team/skills', { method: 'POST', json: { name, userIds } }),
    onSuccess: (v) => qc.setQueryData(teamKey, v),
  });
}

const TEXT = {
  th: { removed: (n: string) => `ลบทักษะ "${n}" ออกจากรายการแล้ว`, undo: 'เลิกทำ' },
  en: { removed: (n: string) => `Skill "${n}" removed from the list`, undo: 'Undo' },
};

/** Takes an unused skill off the list at once, with Undo (adding it back) instead of a confirm. */
export function useRemoveSkill() {
  const qc = useQueryClient();
  const { lang } = useLang();
  const add = useAddSkill();
  return useMutation({
    mutationFn: (name: string) => api<unknown>(`/team/skills?name=${encodeURIComponent(name)}`, { method: 'DELETE' }),
    onMutate: async (name) => {
      await qc.cancelQueries({ queryKey: teamKey });
      const before = qc.getQueryData<Team>(teamKey);
      qc.setQueryData<Team>(teamKey, (old) => old && { ...old, catalog: old.catalog.filter((s) => s !== name) });
      return { before };
    },
    onError: (e, _n, ctx) => {
      if (ctx?.before) qc.setQueryData(teamKey, ctx.before);
      toast.error(errorMessage(e, lang));
    },
    onSuccess: (_r, name) =>
      toast(TEXT[lang].removed(name), {
        action: {
          label: TEXT[lang].undo,
          onClick: () => add.mutate({ name, userIds: [] }, { onError: (e) => toast.error(errorMessage(e, lang)) }),
        },
      }),
  });
}
