'use client';
import { Archive, MoreHorizontal } from 'lucide-react';
import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useConfirm } from '../shared/confirm';
import { useT } from '../shared/i18n';
import type { ListData } from './board-cache';
import { useArchiveList, useUpdateList } from './mutations';

const TEXT = {
  th: {
    actions: (n: string) => `การทำงานของลิสต์ ${n}`,
    rename: 'เปลี่ยนชื่อ',
    done: 'ลิสต์เสร็จสิ้น',
    archive: 'เก็บลิสต์ถาวร',
    confirmTitle: (n: string) => `เก็บลิสต์ "${n}" ถาวร?`,
    confirmDesc: 'การ์ดทั้งหมดในลิสต์นี้จะถูกซ่อนไปด้วย กู้คืนได้จากรายการที่เก็บถาวร',
  },
  en: {
    actions: (n: string) => `Actions for list ${n}`,
    rename: 'Rename',
    done: 'Mark as done list',
    archive: 'Archive list',
    confirmTitle: (n: string) => `Archive list "${n}"?`,
    confirmDesc: 'All cards in this list are hidden with it. Restore them from the archive.',
  },
};

export function ListMenu({ projectId, list, onRename }: { projectId: number; list: ListData; onRename: () => void }) {
  const t = useT(TEXT);
  const confirm = useConfirm();
  const update = useUpdateList(projectId);
  const archive = useArchiveList(projectId);
  // Rename starts only after the menu has closed: while it is open its focus trap would pull focus
  // off the new input, and the input's blur would end the rename at once. Radix also returns focus
  // to the trigger on close; skip that so the input keeps it.
  const renameNext = useRef(false);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t.actions(list.name)}>
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-48"
        onCloseAutoFocus={(e) => {
          if (renameNext.current) {
            e.preventDefault();
            renameNext.current = false;
            onRename();
          }
        }}
      >
        <DropdownMenuItem
          onSelect={() => {
            renameNext.current = true;
          }}
        >
          {t.rename}
        </DropdownMenuItem>
        <DropdownMenuCheckboxItem
          checked={list.isDone}
          onCheckedChange={(v) => update.mutate({ listId: list.id, isDone: v === true })}
        >
          {t.done}
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onSelect={async () => {
            const ok = await confirm({
              title: t.confirmTitle(list.name),
              description: t.confirmDesc,
              confirmLabel: t.archive,
              destructive: true,
            });
            if (ok) archive.mutate(list.id);
          }}
        >
          <Archive aria-hidden />
          {t.archive}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
