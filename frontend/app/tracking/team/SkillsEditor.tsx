'use client';
import { Pencil, X } from 'lucide-react';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useT } from '../shared/i18n';
import { cleanSkills, MAX_SKILL, MAX_SKILLS } from './queries';

const TEXT = {
  th: {
    edit: (n: string) => `แก้ไขทักษะของ ${n}`,
    title: (n: string) => `ทักษะของ ${n}`,
    input: 'เพิ่มทักษะ',
    hint: 'พิมพ์แล้วกด Enter หรือจุลภาค (,)',
    remove: (s: string) => `ลบ ${s}`,
    none: 'ยังไม่มีทักษะ',
    tooLong: `ทักษะหนึ่งยาวได้ไม่เกิน ${MAX_SKILL} ตัวอักษร`,
    tooMany: `ใส่ได้ไม่เกิน ${MAX_SKILLS} ทักษะ`,
    cancel: 'ยกเลิก',
    save: 'บันทึก',
  },
  en: {
    edit: (n: string) => `Edit ${n}'s skills`,
    title: (n: string) => `${n}'s skills`,
    input: 'Add a skill',
    hint: 'Type and press Enter or comma (,)',
    remove: (s: string) => `Remove ${s}`,
    none: 'No skills yet',
    tooLong: `A skill can be at most ${MAX_SKILL} characters`,
    tooMany: `At most ${MAX_SKILLS} skills`,
    cancel: 'Cancel',
    save: 'Save',
  },
};

type Props = {
  name: string;
  skills: string[];
  /** Skills other people already use, offered as suggestions so the team spells them the same way. */
  suggestions: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (skills: string[]) => void;
};

export function SkillsEditor({ name, skills, suggestions, open, onOpenChange, onSave }: Props) {
  const t = useT(TEXT);
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label={t.edit(name)} title={t.edit(name)}>
          <Pencil aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3">
        {/* Remounted on every open, so a cancelled draft does not come back. */}
        {open && (
          <Editor name={name} skills={skills} suggestions={suggestions} onCancel={() => onOpenChange(false)} onSave={onSave} />
        )}
      </PopoverContent>
    </Popover>
  );
}

function Editor({
  name,
  skills,
  suggestions,
  onCancel,
  onSave,
}: Pick<Props, 'name' | 'skills' | 'suggestions' | 'onSave'> & { onCancel: () => void }) {
  const t = useT(TEXT);
  const [draft, setDraft] = useState(skills);
  const [text, setText] = useState('');
  const [error, setError] = useState<'tooLong' | 'tooMany' | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const ids = useId();

  // Adds what is typed (a pasted "a, b" adds both). Returns the new list, or null when a limit refused it.
  const commit = (): string[] | null => {
    const parts = text.split(',');
    if (parts.some((p) => p.trim().length > MAX_SKILL)) {
      setError('tooLong');
      input.current?.focus();
      return null;
    }
    const next = cleanSkills([...draft, ...parts]);
    if (next.length > MAX_SKILLS) {
      setError('tooMany');
      input.current?.focus();
      return null;
    }
    setDraft(next);
    setText('');
    setError(null);
    return next;
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && text === '' && draft.length > 0) {
      setDraft(draft.slice(0, -1));
    }
  };
  const remove = (s: string) => {
    setDraft(draft.filter((x) => x !== s));
    setError(null);
    input.current?.focus();
  };
  const offer = suggestions.filter((s) => !draft.some((d) => d.toLocaleLowerCase() === s.toLocaleLowerCase()));

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const next = commit();
        if (next) onSave(next);
      }}
      className="flex flex-col gap-3"
    >
      <p id={`${ids}-title`} className="text-sm font-semibold">
        {t.title(name)}
      </p>
      {draft.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t.none}</p>
      ) : (
        <ul aria-labelledby={`${ids}-title`} className="flex flex-wrap gap-1.5">
          {draft.map((s) => (
            <li key={s} className="flex items-center gap-0.5 rounded-full bg-secondary py-0.5 pr-0.5 pl-2.5 text-xs font-medium">
              {s}
              <button
                type="button"
                aria-label={t.remove(s)}
                title={t.remove(s)}
                onClick={() => remove(s)}
                className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              >
                <X className="size-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-1">
        <label htmlFor={`${ids}-input`} className="text-xs font-medium">
          {t.input}
        </label>
        <Input
          ref={input}
          id={`${ids}-input`}
          autoFocus
          value={text}
          list={`${ids}-list`}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          onKeyDown={onKey}
          aria-invalid={error !== null}
          aria-describedby={`${ids}-hint ${error ? `${ids}-error` : ''}`}
          // Suggestions appear as you type; Chrome's dropdown arrow on a datalist field looks like a select.
          className="h-8 [&::-webkit-calendar-picker-indicator]:hidden"
        />
        <datalist id={`${ids}-list`}>
          {offer.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <p id={`${ids}-hint`} className="text-[11px] text-muted-foreground">
          {t.hint}
        </p>
        {error && (
          <p id={`${ids}-error`} role="alert" className="text-xs text-destructive">
            {t[error]}
          </p>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t.cancel}
        </Button>
        <Button type="submit" size="sm">
          {t.save}
        </Button>
      </div>
    </form>
  );
}
