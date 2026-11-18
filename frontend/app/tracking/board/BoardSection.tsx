'use client';
import { ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useBoard } from '../shared/api/queries';
import { useT } from '../shared/i18n';
import { Board } from './Board';
import { BoardFilters } from './BoardFilters';

const OPEN_KEY = 'pt-board-open';

const TEXT = {
  th: {
    board: 'บอร์ด',
    title: (l: number, c: number) => `บอร์ด · ${l} ลิสต์ · ${c} การ์ด`,
  },
  en: {
    board: 'Board',
    title: (l: number, c: number) => `Board · ${l} list${l === 1 ? '' : 's'} · ${c} card${c === 1 ? '' : 's'}`,
  },
};

// Per-viewer convenience only: any storage failure just leaves the section open.
function readOpen() {
  try {
    return localStorage.getItem(OPEN_KEY) !== '0';
  } catch {
    return true;
  }
}

/** The collapsible board region of the project page; the Timeline section sits below it. */
export function BoardSection({
  projectId,
  onOpenChange,
}: {
  projectId: number;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useT(TEXT);
  const board = useBoard(projectId);
  // Open on the server and first paint (no hydration mismatch); the saved choice applies right after mount.
  const [open, setOpen] = useState(true);
  useEffect(() => setOpen(readOpen()), []);
  useEffect(() => onOpenChange?.(open), [open, onOpenChange]);
  const flip = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(OPEN_KEY, next ? '1' : '0');
    } catch {
      /* storage unavailable: the choice lasts for this visit only */
    }
  };
  const title = board.data ? t.title(board.data.lists.length, board.data.cards.length) : t.board;

  return (
    <section className="flex flex-col border-t bg-muted/40 pt-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="board-section-body"
        onClick={flip}
        className="mx-4 mb-3 flex w-fit items-center gap-1.5 rounded text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <ChevronDown className={`size-4 transition-transform ${open ? '' : '-rotate-90'}`} aria-hidden />
        {title}
      </button>
      <div id="board-section-body" hidden={!open}>
        {open && (
          <>
            <BoardFilters />
            <Board projectId={projectId} />
          </>
        )}
      </div>
    </section>
  );
}
