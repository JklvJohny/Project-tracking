'use client';
import { createContext, useCallback, useContext, useId, useRef, useState, type ReactNode } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { useT } from './i18n';

const TEXT = {
  th: { cancel: 'ยกเลิก', ok: 'ยืนยัน', type: (v: string) => `พิมพ์ "${v}" เพื่อยืนยัน` },
  en: { cancel: 'Cancel', ok: 'Confirm', type: (v: string) => `Type "${v}" to confirm` },
};

export type ConfirmOptions = {
  title: string;
  description?: string;
  /** Defaults to the localised "Confirm". */
  confirmLabel?: string;
  destructive?: boolean;
  /**
   * The user must type this text (usually the item's name) before the confirm button enables. Guards actions that
   * are heavy to undo, such as archiving a whole project. Compared after trimming, case-sensitive.
   */
  typeToConfirm?: string;
};

type Confirm = (opts: ConfirmOptions) => Promise<boolean>;
const ConfirmContext = createContext<Confirm | null>(null);

/** Promise-based confirm dialog: `if (await confirm({ title })) ...`. Callers pass already-translated text. */
export function useConfirm(): Confirm {
  const c = useContext(ConfirmContext);
  if (!c) throw new Error('ConfirmProvider missing');
  return c;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const t = useT(TEXT);
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [typed, setTyped] = useState('');
  const inputId = useId();
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<Confirm>((o) => {
    resolver.current?.(false);
    setTyped('');
    setOpts(o);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const blocked = !!opts?.typeToConfirm && typed.trim() !== opts.typeToConfirm.trim();
  const settle = (v: boolean) => {
    resolver.current?.(v);
    resolver.current = null;
    setOpts(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog open={opts !== null} onOpenChange={(open) => !open && settle(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{opts?.title}</AlertDialogTitle>
            {opts?.description && <AlertDialogDescription>{opts.description}</AlertDialogDescription>}
          </AlertDialogHeader>
          {opts?.typeToConfirm && (
            <div className="grid gap-1.5">
              <label htmlFor={inputId} className="text-sm">
                {t.type(opts.typeToConfirm)}
              </label>
              <Input
                id={inputId}
                value={typed}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing && !blocked) {
                    e.preventDefault();
                    settle(true);
                  }
                }}
              />
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
            <AlertDialogAction
              // The variant, not a className: asChild concatenates classes, so bg-primary would win over bg-destructive.
              variant={opts?.destructive ? 'destructive' : 'default'}
              disabled={blocked}
              onClick={() => settle(true)}
            >
              {opts?.confirmLabel ?? t.ok}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}
