'use client';
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
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
import { useT } from './i18n';

const TEXT = {
  th: { cancel: 'ยกเลิก', ok: 'ยืนยัน' },
  en: { cancel: 'Cancel', ok: 'Confirm' },
};

export type ConfirmOptions = {
  title: string;
  description?: string;
  /** Defaults to the localised "Confirm". */
  confirmLabel?: string;
  destructive?: boolean;
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
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<Confirm>((o) => {
    resolver.current?.(false);
    setOpts(o);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

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
          <AlertDialogFooter>
            <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
            <AlertDialogAction
              className={opts?.destructive ? 'bg-destructive text-white hover:bg-destructive/90' : undefined}
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
