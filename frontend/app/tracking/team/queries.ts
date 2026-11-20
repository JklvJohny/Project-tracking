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
export type Category = S['SkillCategory'];
export type CatalogEntry = Team['catalog'][number];
export type SkillCount = { name: string; count: number; categoryId: number | null };

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
 * yet (the catalog) come with count 0. A skill's category comes from the catalog; one only on cards has none.
 */
export function allSkills(people: Person[], catalog: CatalogEntry[] = []): SkillCount[] {
  const by = new Map<string, SkillCount>();
  for (const s of catalog) by.set(s.name.toLocaleLowerCase(), { name: s.name, count: 0, categoryId: s.categoryId ?? null });
  for (const p of people)
    for (const s of p.skills) {
      const k = s.toLocaleLowerCase();
      const e = by.get(k);
      if (e) e.count++;
      else by.set(k, { name: s, count: 1, categoryId: null });
    }
  return [...by.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export type SkillGroup = { category: Category | null; skills: SkillCount[] };

/**
 * Skills by category, in the categories' order. Every category is listed, empty ones too, so a new one has somewhere
 * to add to; the uncategorised group comes last and only when it has skills.
 */
export function groupSkills(skills: SkillCount[], categories: Category[]): SkillGroup[] {
  const known = new Set(categories.map((c) => c.id));
  const groups: SkillGroup[] = categories.map((c) => ({ category: c, skills: skills.filter((s) => s.categoryId === c.id) }));
  const rest = skills.filter((s) => s.categoryId === null || !known.has(s.categoryId));
  if (rest.length > 0) groups.push({ category: null, skills: rest });
  return groups;
}

/** Names a skill for the department and gives it to the chosen people; the server answers with the whole Team view. */
export function useAddSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, userIds, categoryId = null }: { name: string; userIds: number[]; categoryId?: number | null }) =>
      api<Team>('/team/skills', { method: 'POST', json: { name, userIds, categoryId } }),
    onSuccess: (v) => qc.setQueryData(teamKey, v),
  });
}

const TEXT = {
  th: {
    removed: (n: string) => `ลบทักษะ "${n}" ออกจากรายการแล้ว`,
    undo: 'เลิกทำ',
    catRemoved: (n: string) => `ลบหมวดหมู่ "${n}" แล้ว`,
  },
  en: {
    removed: (n: string) => `Skill "${n}" removed from the list`,
    undo: 'Undo',
    catRemoved: (n: string) => `Category "${n}" deleted`,
  },
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
      qc.setQueryData<Team>(teamKey, (old) => old && { ...old, catalog: old.catalog.filter((s) => s.name !== name) });
      return { before };
    },
    onError: (e, _n, ctx) => {
      if (ctx?.before) qc.setQueryData(teamKey, ctx.before);
      toast.error(errorMessage(e, lang));
    },
    onSuccess: (_r, name, ctx) => {
      // Undo puts it back in the category it was in.
      const categoryId = ctx?.before?.catalog.find((s) => s.name === name)?.categoryId ?? null;
      toast(TEXT[lang].removed(name), {
        action: {
          label: TEXT[lang].undo,
          onClick: () => add.mutate({ name, userIds: [], categoryId }, { onError: (e) => toast.error(errorMessage(e, lang)) }),
        },
      });
    },
  });
}

/**
 * Moves a skill into a category (null: none). Optimistic: the chip moves at once and goes back with an error toast.
 * A skill only on people's cards gets a catalog entry here, as the server does.
 */
export function useSetSkillCategory() {
  const qc = useQueryClient();
  const { lang } = useLang();
  return useMutation({
    mutationFn: ({ name, categoryId }: { name: string; categoryId: number | null }) =>
      api<Team>('/team/skills/category', { method: 'PUT', json: { name, categoryId } }),
    onMutate: async ({ name, categoryId }) => {
      await qc.cancelQueries({ queryKey: teamKey });
      const before = qc.getQueryData<Team>(teamKey);
      const k = name.toLocaleLowerCase();
      qc.setQueryData<Team>(teamKey, (old) => {
        if (!old) return old;
        const has = old.catalog.some((s) => s.name.toLocaleLowerCase() === k);
        const catalog = has
          ? old.catalog.map((s) => (s.name.toLocaleLowerCase() === k ? { ...s, categoryId } : s))
          : [...old.catalog, { name, categoryId }];
        return { ...old, catalog };
      });
      return { before };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.before) qc.setQueryData(teamKey, ctx.before);
      toast.error(errorMessage(e, lang));
    },
    onSuccess: (v) => qc.setQueryData(teamKey, v),
  });
}

/** Adds a category. Not optimistic: the server issues the id. Callers show errors inline. */
export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api<Team>('/team/categories', { method: 'POST', json: { name } }),
    onSuccess: (v) => qc.setQueryData(teamKey, v),
  });
}

/** Renames a category. Callers show errors inline, next to the field. */
export function useRenameCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      api<Team>(`/team/categories/${id}`, { method: 'PATCH', json: { name } }),
    onSuccess: (v) => qc.setQueryData(teamKey, v),
  });
}

/** Deletes a category; its skills become uncategorised. Callers confirm first when it has skills. */
export function useDeleteCategory() {
  const qc = useQueryClient();
  const { lang } = useLang();
  return useMutation({
    mutationFn: (c: Category) => api<Team>(`/team/categories/${c.id}`, { method: 'DELETE' }),
    onSuccess: (v, c) => {
      qc.setQueryData(teamKey, v);
      toast.success(TEXT[lang].catRemoved(c.name));
    },
    onError: (e) => toast.error(errorMessage(e, lang)),
  });
}
