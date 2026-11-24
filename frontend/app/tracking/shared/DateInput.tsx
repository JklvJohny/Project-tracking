'use client';
import { X } from 'lucide-react';
import { useRef, useState, type ComponentProps } from 'react';
import { Input } from '@/components/ui/input';
import { fmtDate } from './format';
import { useLang, useT } from './i18n';

const TEXT = {
  th: { none: 'ไม่ระบุ', clear: 'ล้างวันที่' },
  en: { none: 'Not set', clear: 'Clear date' },
};

/**
 * A form date field (uncontrolled, read through FormData by `name`). The native field draws its digits in the
 * browser's locale (11/16/2026 on an English Windows) whatever the app language, so its text is hidden and the app's
 * own format is drawn over it; a click opens the picker and × clears it.
 */
export function DateInput({
  defaultValue = '',
  disabled,
  className = '',
  ...props
}: Omit<ComponentProps<'input'>, 'type' | 'value' | 'defaultValue'> & { defaultValue?: string }) {
  const t = useT(TEXT);
  const { lang } = useLang();
  const [value, setValue] = useState(defaultValue);
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="relative">
      <Input
        {...props}
        ref={ref}
        type="date"
        disabled={disabled}
        defaultValue={defaultValue}
        onInput={(e) => setValue(e.currentTarget.value)}
        onChange={(e) => {
          setValue(e.currentTarget.value);
          props.onChange?.(e);
        }}
        onClick={(e) => {
          if (!disabled) e.currentTarget.showPicker?.();
          props.onClick?.(e);
        }}
        className={`w-full cursor-pointer text-transparent [&::-webkit-datetime-edit]:text-transparent ${className}`}
      />
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm ${disabled ? 'opacity-50' : ''}`}
      >
        {value ? fmtDate(value, lang) : <span className="text-muted-foreground">{t.none}</span>}
      </span>
      {value && !disabled && (
        <button
          type="button"
          aria-label={t.clear}
          title={t.clear}
          onClick={() => {
            const el = ref.current;
            if (!el) return;
            el.value = '';
            setValue('');
            // Let React-style listeners and the form see the change as if typed.
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }}
          className="absolute top-1/2 right-9 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}
