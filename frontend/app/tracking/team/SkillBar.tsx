'use client';
import { ChevronDown, Plus, X } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ApiError } from '../shared/api/client';
import { Avatar } from '../shared/Avatar';
import { errorMessage } from '../shared/errors';
import { useLang, useT } from '../shared/i18n';
import { useStoredOpen } from '../board/useStoredOpen';
import { cleanSkills, MAX_SKILL, useAddSkill, useRemoveSkill, type Person } from './queries';

export const SKILLS_OPEN_KEY = 'pt-team-skills-open';

const TEXT = {
  th: {
    all: 'ทักษะทั้งหมด',
    list: 'กรองตามทักษะ',
    chosen: 'ทักษะที่เลือก',
    unchoose: (s: string) => `เลิกกรองด้วย ${s}`,
    add: 'ทักษะใหม่',
    remove: (s: string) => `ลบ ${s} ออกจากรายการทักษะ`,
    unused: 'ยังไม่มีใครมีทักษะนี้',
    name: 'ชื่อทักษะ',
    give: 'ให้กับ (ไม่บังคับ)',
    has: 'มีแล้ว',
    cancel: 'ยกเลิก',
    save: 'เพิ่ม',
    errors: {
      required: 'กรุณาใส่ชื่อทักษะ',
      too_long: `ยาวได้ไม่เกิน ${MAX_SKILL} ตัวอักษร`,
      exists: 'มีทักษะนี้ในรายการแล้ว เลือกคนที่จะเพิ่มให้ หรือใช้ชื่ออื่น',
      too_many: 'บางคนที่เลือกมีทักษะครบ 30 แล้ว',
      unknown: 'ไม่พบบางคนที่เลือก',
    } as Record<string, string>,
  },
  en: {
    all: 'All skills',
    list: 'Filter by skill',
    chosen: 'Chosen skills',
    unchoose: (s: string) => `Stop filtering by ${s}`,
    add: 'New skill',
    remove: (s: string) => `Remove ${s} from the skill list`,
    unused: 'Nobody has this skill yet',
    name: 'Skill name',
    give: 'Give to (optional)',
    has: 'has it',
    cancel: 'Cancel',
    save: 'Add',
    errors: {
      required: 'Enter a skill name',
      too_long: `At most ${MAX_SKILL} characters`,
      exists: 'This skill is already listed. Pick people to give it to, or use another name.',
      too_many: 'Someone you picked already has 30 skills',
      unknown: 'Someone you picked was not found',
    } as Record<string, string>,
  },
};

const chip = 'rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring';

type Props = {
  skills: { name: string; count: number }[];
  chosen: string[];
  people: Person[];
  onToggle: (s: string) => void;
};

/** The team's skills as filter chips, folded away by default; also where a new skill is added to the list. */
export function SkillBar({ skills, chosen, people, onToggle }: Props) {
  const t = useT(TEXT);
  const [open, setOpen] = useStoredOpen(SKILLS_OPEN_KEY, false);
  const remove = useRemoveSkill();
  const ids = useId();
  const picked = new Set(chosen.map((s) => s.toLocaleLowerCase()));
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
        <AddSkill skills={skills} people={people} />
      </div>
      <div id={`${ids}-skills`} hidden={!open}>
        {open && (
          <ul aria-label={t.list} className="flex flex-wrap gap-1.5">
            {skills.map(({ name, count }) => {
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
        )}
      </div>
    </div>
  );
}

function AddSkill({ skills, people }: { skills: { name: string }[]; people: Person[] }) {
  const t = useT(TEXT);
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="ml-auto h-8">
          <Plus aria-hidden />
          {t.add}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3">
        {/* Remounted on every open, so a cancelled draft does not come back. */}
        {open && <AddSkillForm skills={skills} people={people} onDone={() => setOpen(false)} />}
      </PopoverContent>
    </Popover>
  );
}

function AddSkillForm({ skills, people, onDone }: { skills: { name: string }[]; people: Person[]; onDone: () => void }) {
  const t = useT(TEXT);
  const { lang } = useLang();
  const add = useAddSkill();
  const [name, setName] = useState('');
  const [who, setWho] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const ids = useId();
  const clean = cleanSkills([name])[0] ?? '';
  const key = clean.toLocaleLowerCase();

  const fail = (code: string) => {
    setError(code);
    field.current?.focus();
  };
  const submit = () => {
    if (!clean) return fail('required');
    if (clean.length > MAX_SKILL) return fail('too_long');
    if (who.length === 0 && skills.some((s) => s.name.toLocaleLowerCase() === key)) return fail('exists');
    add.mutate(
      { name: clean, userIds: who },
      {
        onSuccess: onDone,
        onError: (e) => {
          const code = e instanceof ApiError ? (e.fields?.name ?? e.fields?.userIds) : undefined;
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
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          {t.cancel}
        </Button>
        <Button type="submit" size="sm" disabled={add.isPending}>
          {t.save}
        </Button>
      </div>
    </form>
  );
}
