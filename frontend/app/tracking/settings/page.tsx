'use client';
import { Check, Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { useId } from 'react';
import { DARK_PALETTES, useT, useTheme, type DarkPalette, type Theme } from '../shared/i18n';

const THEMES: { value: Theme; icon: LucideIcon }[] = [
  { value: 'light', icon: Sun },
  { value: 'dark', icon: Moon },
  { value: 'system', icon: Monitor },
];

const TEXT = {
  th: {
    title: 'ตั้งค่า',
    lead: 'การตั้งค่านี้จำไว้ในเบราว์เซอร์นี้เท่านั้น',
    appearance: 'การแสดงผล',
    theme: 'ธีม',
    themes: { light: 'สว่าง', dark: 'มืด', system: 'ตามระบบ' } as Record<Theme, string>,
    palette: 'สีของโหมดมืด',
    paletteHint: 'ใช้เมื่อธีมเป็นโหมดมืด',
    paletteNowLight: 'ตอนนี้ใช้ธีมสว่างอยู่ สีนี้จะเห็นเมื่อเปลี่ยนเป็นโหมดมืด',
    palettes: {
      slate: { name: 'เทาอมฟ้า', desc: 'นุ่มตา เหมาะกับใช้ทั้งวัน' },
      graphite: { name: 'เทากราไฟต์', desc: 'เทากลาง ไม่อมสีใด' },
      warm: { name: 'เทาอุ่น', desc: 'โทนอบอุ่น ไม่มีสีฟ้า' },
      navy: { name: 'น้ำเงินเข้ม', desc: 'เข้มที่สุด โทนน้ำเงิน' },
      ocean: { name: 'ฟ้าทะเล', desc: 'โทนฟ้าอมเขียว สบายตา' },
      forest: { name: 'เขียวป่า', desc: 'โทนเขียวเข้ม ผ่อนคลาย' },
      plum: { name: 'ม่วงพลัม', desc: 'โทนม่วงเข้ม นุ่มนวล' },
    } as Record<DarkPalette, { name: string; desc: string }>,
  },
  en: {
    title: 'Settings',
    lead: 'These settings are kept in this browser only.',
    appearance: 'Appearance',
    theme: 'Theme',
    themes: { light: 'Light', dark: 'Dark', system: 'System' } as Record<Theme, string>,
    palette: 'Dark mode colours',
    paletteHint: 'Used when the theme is dark.',
    paletteNowLight: 'The light theme is on; this shows once you switch to dark.',
    palettes: {
      slate: { name: 'Slate', desc: 'Soft blue-grey, easy for a full day' },
      graphite: { name: 'Graphite', desc: 'Neutral grey with no tint' },
      warm: { name: 'Warm grey', desc: 'Warm tones, no blue' },
      navy: { name: 'Navy', desc: 'The darkest, deep blue' },
      ocean: { name: 'Ocean', desc: 'Calm blue-green' },
      forest: { name: 'Forest', desc: 'Deep, restful green' },
      plum: { name: 'Plum', desc: 'Soft deep purple' },
    } as Record<DarkPalette, { name: string; desc: string }>,
  },
};

/** A miniature page in the palette: it carries class="dark" and data-pt-dark itself, so it shows true in any theme. */
function Swatch({ palette }: { palette: DarkPalette }) {
  return (
    <div aria-hidden className="dark flex h-20 gap-1.5 rounded-md bg-background p-2" data-pt-dark={palette}>
      <div className="w-5 rounded-sm bg-sidebar" />
      <div className="flex flex-1 flex-col gap-1.5">
        <div className="h-2 w-2/3 rounded-full bg-foreground/80" />
        <div className="flex flex-1 gap-1.5">
          {[0, 1].map((i) => (
            <div key={i} className="flex flex-1 flex-col gap-1 rounded-sm border bg-card p-1.5">
              <div className="h-1.5 w-full rounded-full bg-muted-foreground/70" />
              <div className="h-1.5 w-1/2 rounded-full bg-muted" />
              <div className={`mt-auto h-1 w-3/4 rounded-full ${i === 0 ? 'bg-(--s-active)' : 'bg-(--s-done)'}`} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Native radios inside labels: arrow keys move the choice and screen readers announce the group for free.
const radio = 'peer sr-only';

export default function SettingsPage() {
  const t = useT(TEXT);
  const { theme, setTheme, resolvedTheme, darkPalette, setDarkPalette } = useTheme();
  const ids = useId();
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-5 sm:px-6 sm:py-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t.lead}</p>
      </div>

      <section aria-labelledby={`${ids}-appearance`} className="flex flex-col gap-5 rounded-xl border bg-card p-4 sm:p-5">
        <h2 id={`${ids}-appearance`} className="text-base font-semibold">
          {t.appearance}
        </h2>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">{t.theme}</legend>
          <div className="grid grid-cols-3 gap-2 sm:w-96">
            {THEMES.map(({ value, icon: Icon }) => (
              <label key={value} className="cursor-pointer">
                <input type="radio" name={`${ids}-theme`} value={value} checked={theme === value} onChange={() => setTheme(value)} className={radio} />
                <span className="flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm hover:bg-accent peer-checked:border-primary peer-checked:bg-accent peer-checked:font-medium peer-focus-visible:outline-2 peer-focus-visible:outline-ring">
                  <Icon className="size-4" aria-hidden />
                  {t.themes[value]}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2" aria-describedby={`${ids}-palette-hint`}>
          <legend className="text-sm font-medium">{t.palette}</legend>
          <p id={`${ids}-palette-hint`} className="text-xs text-muted-foreground">
            {resolvedTheme === 'light' ? t.paletteNowLight : t.paletteHint}
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {DARK_PALETTES.map((p) => {
              const on = darkPalette === p;
              return (
                <label key={p} className="cursor-pointer">
                  <input type="radio" name={`${ids}-palette`} value={p} checked={on} onChange={() => setDarkPalette(p)} className={radio} />
                  <span className="flex flex-col gap-2 rounded-lg border p-2 hover:bg-accent peer-checked:border-primary peer-checked:ring-1 peer-checked:ring-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring">
                    <Swatch palette={p} />
                    <span className="flex items-start gap-1.5 px-0.5">
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="text-sm font-medium">{t.palettes[p].name}</span>
                        <span className="text-xs text-muted-foreground">{t.palettes[p].desc}</span>
                      </span>
                      {/* The checked state is also a tick, not only the border colour. */}
                      {on && <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      </section>
    </div>
  );
}
