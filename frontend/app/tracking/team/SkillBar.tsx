'use client';
import { ChevronDown, FolderTree, Plus, X } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ApiError } from '../shared/api/client';
import { Avatar } from '../shared/Avatar';
import { errorMessage } from '../shared/errors';
import { useLang, useT } from '../shared/i18n';
import { useStoredOpen } from '../board/useStoredOpen';
import { CategoryDialog } from './CategoryDialog';
import {
  cleanSkills,
  groupSkills,
  MAX_SKILL,
  useAddSkill,
  useRemoveSkill,
  type Category,
  type Person,
  type SkillCount,
} from './queries';

export const SKILLS_OPEN_KEY = 'pt-team-skills-open';
/** Select value for "no category"; Radix Select items cannot have an empty value. */
const NONE = 'none';

const TEXT = {
  th: {
    all: 'ทักษะทั้งหมด',
    list: 'กรองตามทักษะ',
    chosen: 'ทักษะที่เลือก',
    unchoose: (s: string) => `เลิกกรองด้วย ${s}`,
    addIn: (c: string) => `เพิ่มทักษะในหมวด ${c}`,
    categories: 'หมวดหมู่',
    uncategorised: 'ไม่มีหมวดหมู่',
    emptyCategory: 'ยังไม่มีทักษะในหมวดนี้',
    picked: (n: number) => `เลือก ${n}`,
    remove: (s: string) => `ลบ ${s} ออกจากรายการทักษะ`,
    unused: 'ยังไม่มีใครมีทักษะนี้',
    name: 'ชื่อทักษะ',
    category: 'หมวดหมู่',
    give: 'ให้กับ (ไม่บังคับ)',
    has: 'มีแล้ว',
    cancel: 'ยกเลิก',
    save: 'เพิ่ม',
    errors: {
      required: 'กรุณาใส่ชื่อทักษะ',
      too_long: `ยาวได้ไม่เกิน ${MAX_SKILL} ตัวอักษร`,
      exists: 'มีทักษะนี้ในรายการแล้ว เลือกคนที่จะเพิ่มให้ หรือใช้ชื่ออื่น',
      too_many: 'บางคนที่เลือกมีทักษะครบ 30 แล้ว',
      unknown: 'ไม่พบบางคนที่เลือก หรือหมวดหมู่ถูกลบไปแล้ว',
    } as Record<string, string>,
  },
  en: {
    all: 'All skills',
    list: 'Filter by skill',
    chosen: 'Chosen skills',
    unchoose: (s: string) => `Stop filtering by ${s}`,
    addIn: (c: string) => `Add a skill to ${c}`,
    categories: 'Categories',
    uncategorised: 'Uncategorised',
    emptyCategory: 'No skills in this category yet',
    picked: (n: number) => `${n} chosen`,
    remove: (s: string) => `Remove ${s} from the skill list`,
    unused: 'Nobody has this skill yet',
    name: 'Skill name',
    category: 'Category',
    give: 'Give to (optional)',
    has: 'has it',
    cancel: 'Cancel',
    save: 'Add',
    errors: {
      required: 'Enter a skill name',
      too_long: `At most ${MAX_SKILL} characters`,
      exists: 'This skill is already listed. Pick people to give it to, or use another name.',
      too_many: 'Someone you picked already has 30 skills',
      unknown: 'Someone you picked, or the category, was not found',
    } as Record<string, string>,
  },
};

const chip = 'rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring';

type Props = {
  skills: SkillCount[];
  categories: Category[];
  chosen: string[];
  people: Person[];
  onToggle: (s: string) => void;
};

/** The team's skills as filter chips grouped by category, folded away by default; also where skills (the + by each category) and categories are added. */
export function SkillBar({ skills, categories, chosen, people, onToggle }: Props) {
  const t = useT(TEXT);
  const [open, setOpen] = useStoredOpen(SKILLS_OPEN_KEY, false);
  const [managing, setManaging] = useState(false);
  const ids = useId();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${ids}-skills`}
          onClick={() => setOpen(!open)}
          className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-medium hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
        >
          <ChevronDown className={`size-4 transition-transform motion-reduce:transition-none ${open ? '' : '-rotate-90'}`} aria-hidden />
          {t.all}
          <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground tabular-nums">{skills.length}</span>
        </button>
        {/* Folded, the chosen filters stay in view so the narrowed list is never a mystery. */}
        {!open && chosen.length > 0 && (
          <ul aria-label={t.chosen} className="flex flex-wrap gap-1.5">
            {chosen.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  aria-label={t.unchoose(s)}
                  onClick={() => onToggle(s)}
                  className={`${chip} inline-flex items-center gap-1 border border-primary bg-primary text-primary-foreground`}
                >
                  {s}
                  <X className="size-3" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        <Button variant="outline" size="sm" className="ml-auto h-8" onClick={() => setManaging(true)}>
          <FolderTree aria-hidden />
          {t.categories}
        </Button>
      </div>
      <div id={`${ids}-skills`} hidden={!open}>
        {open && <SkillGroups skills={skills} categories={categories} chosen={chosen} people={people} onToggle={onToggle} />}
      </div>
      <CategoryDialog open={managing} onOpenChange={setManaging} skills={skills} categories={categories} />
    </div>
  );
}

export const GROUPS_OPEN_KEY = 'pt-team-skill-groups-open';

/** Which categories are unfolded, remembered per viewer ('c<id>' or 'none'). All start folded. */
function useOpenGroups(): [Set<string>, (key: string, open?: boolean) => void] {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    try {
      const v: unknown = JSON.parse(localStorage.getItem(GROUPS_OPEN_KEY) ?? '[]');
      // eslint-disable-next-line react-hooks/set-state-in-effect -- storage is only readable after mount
      if (Array.isArray(v)) setOpen(new Set(v.filter((x): x is string => typeof x === 'string')));
    } catch {
      /* unreadable or blocked storage: everything stays folded */
    }
  }, []);
  /** Flips the group, or sets it when `to` is given. */
  const toggle = useCallback((key: string, to?: boolean) => {
    setOpen((old) => {
      const next = new Set(old);
      if (to ?? !next.has(key)) next.add(key);
      else next.delete(key);
      try {
        localStorage.setItem(GROUPS_OPEN_KEY, JSON.stringify([...next]));
      } catch {
        /* storage unavailable: the choice lasts for this visit */
      }
      return next;
    });
  }, []);
  return [open, toggle];
}

/** One folding row per category; its skills sit underneath when it is open. */
function SkillGroups({ skills, categories, chosen, people, onToggle }: Props) {
  const t = useT(TEXT);
  const remove = useRemoveSkill();
  const ids = useId();
  const [openGroups, toggleGroup] = useOpenGroups();
  const picked = new Set(chosen.map((s) => s.toLocaleLowerCase()));
  return (
    // Tiles in a grid so names, counts and + line up; items-start lets an open tile grow without stretching its row.
    <div role="group" aria-label={t.list} className="grid items-start gap-2 border-t pt-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {groupSkills(skills, categories).map(({ category, skills: list }) => {
        const key = category ? `c${category.id}` : 'none';
        const open = openGroups.has(key);
        const label = category?.name ?? t.uncategorised;
        const panelId = `${ids}-${key}`;
        const nPicked = list.filter((s) => picked.has(s.name.toLocaleLowerCase())).length;
        return (
          <div
            key={key}
            className={`flex flex-col rounded-lg border bg-background ${category ? '' : 'border-dashed'} ${open ? 'shadow-sm' : ''}`}
          >
            <div className="flex items-center gap-0.5 p-1">
              <button
                type="button"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => toggleGroup(key)}
                className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs font-semibold hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
              >
                <ChevronDown
                  className={`size-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${open ? '' : '-rotate-90'}`}
                  aria-hidden
                />
                <span className={`truncate ${category ? '' : 'text-muted-foreground'}`}>{label}</span>
                {/* Folded, a group still says when it holds a filter in use. */}
                {nPicked > 0 && (
                  <span className="shrink-0 rounded-full bg-primary px-1.5 text-[11px] font-medium text-primary-foreground tabular-nums">
                    {t.picked(nPicked)}
                  </span>
                )}
                <span
                  className={`ml-auto shrink-0 rounded-full px-1.5 text-[11px] font-normal tabular-nums ${
                    list.length === 0 ? 'text-muted-foreground/70' : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {list.length}
                </span>
              </button>
              {category ? (
                // The new chip should be in sight: open the category it went into.
                <AddSkill skills={skills} categories={categories} people={people} preset={category} onAdded={(id) => toggleGroup(id === null ? 'none' : `c${id}`, true)} />
              ) : (
                // No "+" here; the gap keeps its count in line with the other tiles'.
                <span aria-hidden className="size-6 shrink-0" />
              )}
            </div>
            <div id={panelId} hidden={!open} className="border-t px-2.5 py-2">
              {open &&
                (list.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t.emptyCategory}</p>
                ) : (
                  <ul aria-label={label} className="flex flex-wrap gap-1.5">
                    {list.map(({ name, count }) => {
                      const on = picked.has(name.toLocaleLowerCase());
                      return (
                        <li key={name} className="flex items-center">
                          <button
                            type="button"
                            aria-pressed={on}
                            title={count === 0 ? t.unused : undefined}
                            onClick={() => onToggle(name)}
                            className={`${chip} border ${count === 0 ? 'rounded-r-none border-r-0 border-dashed' : ''} ${
                              on ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-accent'
                            }`}
                          >
                            {name} <span className={`tabular-nums ${on ? 'opacity-80' : 'text-muted-foreground'}`}>{count}</span>
                          </button>
                          {/* Only an unused skill can leave the list: a used one stays while anyone has it. */}
                          {count === 0 && (
                            <button
                              type="button"
                              aria-label={t.remove(name)}
                              title={t.remove(name)}
                              onClick={() => remove.mutate(name)}
                              className="inline-flex h-[22px] items-center rounded-r-full border border-dashed bg-background pr-1.5 pl-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                            >
                              <X className="size-3" aria-hidden />
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

type AddProps = {
  skills: SkillCount[];
  categories: Category[];
  people: Person[];
  preset: Category;
  /** Called with the category the skill went into (the form can change it). */
  onAdded?: (categoryId: number | null) => void;
};

/** The small "+" beside a category: the new-skill form, starting in that category. */
function AddSkill({ skills, categories, people, preset, onAdded }: AddProps) {
  const t = useT(TEXT);
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 shrink-0 text-muted-foreground"
          aria-label={t.addIn(preset.name)}
          title={t.addIn(preset.name)}
        >
          <Plus aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-3">
        {/* Remounted on every open, so a cancelled draft does not come back. */}
        {open && (
          <AddSkillForm
            skills={skills}
            categories={categories}
            people={people}
            preset={preset}
            onDone={(categoryId) => {
              setOpen(false);
              if (categoryId !== undefined) onAdded?.(categoryId);
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

/** onDone gets the category the skill was added to, or undefined when cancelled. */
function AddSkillForm({ skills, categories, people, preset, onDone }: Omit<AddProps, 'onAdded'> & { onDone: (categoryId?: number | null) => void }) {
  const t = useT(TEXT);
  const { lang } = useLang();
  const add = useAddSkill();
  const [name, setName] = useState('');
  const [who, setWho] = useState<number[]>([]);
  const [category, setCategory] = useState<string>(String(preset.id));
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const ids = useId();
  const clean = cleanSkills([name])[0] ?? '';
  const key = clean.toLocaleLowerCase();
  const categoryId = category === NONE ? null : Number(category);

  const fail = (code: string) => {
    setError(code);
    field.current?.focus();
  };
  const submit = () => {
    if (!clean) return fail('required');
    if (clean.length > MAX_SKILL) return fail('too_long');
    // An existing name is still worth sending when it gives the skill to someone or moves it to another category.
    const existing = skills.find((s) => s.name.toLocaleLowerCase() === key);
    if (existing && who.length === 0 && (categoryId === null || categoryId === existing.categoryId)) return fail('exists');
    add.mutate(
      { name: clean, userIds: who, categoryId },
      {
        onSuccess: () => onDone(categoryId),
        onError: (e) => {
          const code = e instanceof ApiError ? (e.fields?.name ?? e.fields?.userIds ?? e.fields?.categoryId) : undefined;
          if (code && TEXT.en.errors[code]) fail(code);
          else setError(errorMessage(e, lang));
        },
      },
    );
  };

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={`${ids}-name`} className="text-xs font-medium">
          {t.name}
        </label>
        <Input
          ref={field}
          id={`${ids}-name`}
          autoFocus
          value={name}
          maxLength={MAX_SKILL + 20}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          aria-invalid={error !== null}
          aria-describedby={error ? `${ids}-error` : undefined}
          className="h-8"
        />
        {error && (
          <p id={`${ids}-error`} role="alert" className="text-xs text-destructive">
            {t.errors[error] ?? error}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <span id={`${ids}-cat`} className="text-xs font-medium">
          {t.category}
        </span>
        <Select
          value={category}
          onValueChange={(v) => {
            setCategory(v);
            setError(null);
          }}
        >
          <SelectTrigger aria-labelledby={`${ids}-cat`} className="h-8 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t.uncategorised}</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-xs font-medium">{t.give}</legend>
        <ul className="-mx-1 flex max-h-52 flex-col overflow-y-auto">
          {people.map((p) => {
            const has = key !== '' && p.skills.some((s) => s.toLocaleLowerCase() === key);
            const id = `${ids}-p${p.userId}`;
            return (
              <li key={p.userId}>
                <label htmlFor={id} className={`flex items-center gap-2 rounded px-1 py-1 text-sm ${has ? 'opacity-60' : 'hover:bg-accent'}`}>
                  <Checkbox
                    id={id}
                    disabled={has}
                    checked={has || who.includes(p.userId)}
                    onCheckedChange={(c) => {
                      setWho((w) => (c === true ? [...w, p.userId] : w.filter((x) => x !== p.userId)));
                      setError(null);
                    }}
                  />
                  <span aria-hidden className="flex">
                    <Avatar user={{ id: p.userId, name: p.name }} size="xs" />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  {has && <span className="text-[11px] text-muted-foreground">{t.has}</span>}
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => onDone()}>
          {t.cancel}
        </Button>
        <Button type="submit" size="sm" disabled={add.isPending}>
          {t.save}
        </Button>
      </div>
    </form>
  );
}
