'use client';
import { Trash2 } from 'lucide-react';
import { useId, useRef, useState, type RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ApiError } from '../shared/api/client';
import { useConfirm } from '../shared/confirm';
import { errorMessage } from '../shared/errors';
import { useLang, useT } from '../shared/i18n';
import {
  cleanSkills,
  MAX_SKILL,
  useCreateCategory,
  useDeleteCategory,
  useRenameCategory,
  useSetSkillCategory,
  type Category,
  type SkillCount,
} from './queries';

const NONE = 'none';

const TEXT = {
  th: {
    title: 'หมวดหมู่ทักษะ',
    desc: 'จัดกลุ่มทักษะเพื่อให้หาคนได้ง่ายขึ้น ทักษะหนึ่งอยู่ได้หมวดเดียว',
    categories: 'หมวดหมู่',
    none: 'ยังไม่มีหมวดหมู่',
    rename: (c: string) => `ชื่อหมวดหมู่ ${c}`,
    count: (n: number) => `${n} ทักษะ`,
    remove: (c: string) => `ลบหมวดหมู่ ${c}`,
    confirmTitle: (c: string) => `ลบหมวดหมู่ "${c}"?`,
    confirmBody: (n: number) => `ทักษะ ${n} รายการในหมวดนี้จะย้ายไป "ไม่มีหมวดหมู่" ทักษะของแต่ละคนยังอยู่เหมือนเดิม`,
    confirmOk: 'ลบหมวดหมู่',
    newName: 'หมวดหมู่ใหม่',
    add: 'เพิ่มหมวดหมู่',
    skills: 'จัดทักษะเข้าหมวด',
    noSkills: 'ยังไม่มีทักษะ',
    categoryOf: (s: string) => `หมวดหมู่ของ ${s}`,
    people: (n: number) => `${n} คน`,
    uncategorised: 'ไม่มีหมวดหมู่',
    errors: {
      required: 'กรุณาใส่ชื่อหมวดหมู่',
      too_long: `ยาวได้ไม่เกิน ${MAX_SKILL} ตัวอักษร`,
      exists: 'มีหมวดหมู่ชื่อนี้แล้ว',
      too_many: 'มีหมวดหมู่ครบ 50 แล้ว',
    } as Record<string, string>,
  },
  en: {
    title: 'Skill categories',
    desc: 'Group skills so the right people are easier to find. A skill sits in one category.',
    categories: 'Categories',
    none: 'No categories yet',
    rename: (c: string) => `Name of category ${c}`,
    count: (n: number) => `${n} ${n === 1 ? 'skill' : 'skills'}`,
    remove: (c: string) => `Delete category ${c}`,
    confirmTitle: (c: string) => `Delete category "${c}"?`,
    confirmBody: (n: number) =>
      `Its ${n} ${n === 1 ? 'skill moves' : 'skills move'} to "Uncategorised". Nobody loses a skill.`,
    confirmOk: 'Delete category',
    newName: 'New category',
    add: 'Add category',
    skills: 'Put skills in categories',
    noSkills: 'No skills yet',
    categoryOf: (s: string) => `Category of ${s}`,
    people: (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`,
    uncategorised: 'Uncategorised',
    errors: {
      required: 'Enter a category name',
      too_long: `At most ${MAX_SKILL} characters`,
      exists: 'A category with this name exists',
      too_many: 'There are already 50 categories',
    } as Record<string, string>,
  },
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  skills: SkillCount[];
  categories: Category[];
};

/** Add, rename and delete skill categories, and move each skill into one. Every change saves at once. */
export function CategoryDialog({ open, onOpenChange, skills, categories }: Props) {
  const t = useT(TEXT);
  const newField = useRef<HTMLInputElement>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-xl"
        // The first focusable field is an existing category's name, selected: a stray keystroke would rename it.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          newField.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.desc}</DialogDescription>
        </DialogHeader>
        <Categories skills={skills} categories={categories} field={newField} />
        <SkillCategories skills={skills} categories={categories} />
      </DialogContent>
    </Dialog>
  );
}

/**
 * A failed check or write, kept as its code or the error itself: the text is resolved at render, so it follows a
 * language switch instead of staying in the language it was raised in.
 */
type Failure = { code?: string; err?: unknown };

const failureOf = (e: unknown): Failure => ({ code: e instanceof ApiError ? e.fields?.name : undefined, err: e });

/** The inline text for a failure: a known field code, else the general error text. */
function useFailureText() {
  const t = useT(TEXT);
  const { lang } = useLang();
  return (f: Failure) => (f.code && t.errors[f.code] ? t.errors[f.code] : errorMessage(f.err, lang));
}

function Categories({
  skills,
  categories,
  field,
}: Omit<Props, 'open' | 'onOpenChange'> & { field: RefObject<HTMLInputElement | null> }) {
  const t = useT(TEXT);
  const create = useCreateCategory();
  const toText = useFailureText();
  const [name, setName] = useState('');
  const [error, setError] = useState<Failure | null>(null);
  const ids = useId();

  const fail = (f: Failure) => {
    setError(f);
    field.current?.focus();
  };
  const submit = () => {
    const clean = cleanSkills([name])[0] ?? '';
    if (!clean) return fail({ code: 'required' });
    if (clean.length > MAX_SKILL) return fail({ code: 'too_long' });
    if (categories.some((c) => c.name.toLocaleLowerCase() === clean.toLocaleLowerCase())) return fail({ code: 'exists' });
    create.mutate(clean, {
      onSuccess: () => {
        setName('');
        field.current?.focus();
      },
      onError: (e) => fail(failureOf(e)),
    });
  };

  return (
    <section aria-labelledby={`${ids}-h`} className="flex flex-col gap-2">
      <h3 id={`${ids}-h`} className="text-sm font-semibold">
        {t.categories}
      </h3>
      {categories.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t.none}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {categories.map((c) => (
            <CategoryRow key={c.id} category={c} count={skills.filter((s) => s.categoryId === c.id).length} others={categories} />
          ))}
        </ul>
      )}
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex flex-col gap-1"
      >
        <label htmlFor={`${ids}-new`} className="sr-only">
          {t.newName}
        </label>
        <div className="flex gap-2">
          <Input
            ref={field}
            id={`${ids}-new`}
            value={name}
            placeholder={t.newName}
            maxLength={MAX_SKILL + 20}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            aria-invalid={error !== null}
            aria-describedby={error ? `${ids}-err` : undefined}
            className="h-8"
          />
          <Button type="submit" size="sm" variant="outline" className="h-8 shrink-0" disabled={create.isPending}>
            {t.add}
          </Button>
        </div>
        {error && (
          <p id={`${ids}-err`} role="alert" className="text-xs text-destructive">
            {toText(error)}
          </p>
        )}
      </form>
    </section>
  );
}

/** One category: the name saves on Enter or when the field loses focus; Escape drops the change. */
function CategoryRow({ category, count, others }: { category: Category; count: number; others: Category[] }) {
  const t = useT(TEXT);
  const rename = useRenameCategory();
  const remove = useDeleteCategory();
  const confirm = useConfirm();
  const toText = useFailureText();
  const [draft, setDraft] = useState(category.name);
  const [error, setError] = useState<Failure | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const discard = useRef(false);
  const ids = useId();

  const save = () => {
    if (discard.current) {
      discard.current = false;
      return;
    }
    const clean = cleanSkills([draft])[0] ?? '';
    if (clean === category.name) {
      setDraft(clean);
      return;
    }
    const fail = (f: Failure) => {
      setError(f);
      field.current?.focus();
    };
    if (!clean) return fail({ code: 'required' });
    if (clean.length > MAX_SKILL) return fail({ code: 'too_long' });
    if (others.some((c) => c.id !== category.id && c.name.toLocaleLowerCase() === clean.toLocaleLowerCase()))
      return fail({ code: 'exists' });
    rename.mutate({ id: category.id, name: clean }, { onSuccess: () => setDraft(clean), onError: (e) => fail(failureOf(e)) });
  };
  const onDelete = async () => {
    // An empty category is gone with nothing lost; one with skills moves them, so ask.
    if (count > 0) {
      const ok = await confirm({
        title: t.confirmTitle(category.name),
        description: t.confirmBody(count),
        confirmLabel: t.confirmOk,
        destructive: true,
      });
      if (!ok) return;
    }
    remove.mutate(category);
  };

  return (
    <li className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Input
          ref={field}
          aria-label={t.rename(category.name)}
          value={draft}
          maxLength={MAX_SKILL + 20}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              save();
            } else if (e.key === 'Escape') {
              // Escape also closes the dialog, which blurs the field: drop the draft instead of saving it.
              discard.current = true;
              setDraft(category.name);
              setError(null);
            }
          }}
          aria-invalid={error !== null}
          aria-describedby={error ? `${ids}-err` : undefined}
          className="h-8"
        />
        <span className="w-16 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{t.count(count)}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
          aria-label={t.remove(category.name)}
          title={t.remove(category.name)}
          disabled={remove.isPending}
          onClick={onDelete}
        >
          <Trash2 aria-hidden />
        </Button>
      </div>
      {error && (
        <p id={`${ids}-err`} role="alert" className="text-xs text-destructive">
          {toText(error)}
        </p>
      )}
    </li>
  );
}

function SkillCategories({ skills, categories }: Omit<Props, 'open' | 'onOpenChange'>) {
  const t = useT(TEXT);
  const move = useSetSkillCategory();
  const ids = useId();
  const sorted = [...skills].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <section aria-labelledby={`${ids}-h`} className="flex flex-col gap-2 border-t pt-4">
      <h3 id={`${ids}-h`} className="text-sm font-semibold">
        {t.skills}
      </h3>
      {sorted.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t.noSkills}</p>
      ) : (
        <ul className="flex flex-col divide-y">
          {sorted.map((s) => (
            <li key={s.name} className="flex items-center gap-2 py-1.5">
              <span className="min-w-0 flex-1 truncate text-sm">{s.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{t.people(s.count)}</span>
              <Select
                value={s.categoryId === null ? NONE : String(s.categoryId)}
                onValueChange={(v) => move.mutate({ name: s.name, categoryId: v === NONE ? null : Number(v) })}
              >
                <SelectTrigger aria-label={t.categoryOf(s.name)} className="h-8 w-40 shrink-0 sm:w-48">
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
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
