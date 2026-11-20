'use client';
import { ChevronDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useBoard } from '../shared/api/queries';
import { useT } from '../shared/i18n';
import { Board } from './Board';
import { BoardFilters } from './BoardFilters';
import { EMPTY_FILTER, isFiltering, matchesFilter, type CardFilter } from './card-filter';
import { todayIso } from '../shared/format';

export const BOARD_OPEN_KEY = 'pt-board-open';

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

/**
 * The collapsible board region of the project page; the Timeline section sits below it.
 * Open state is owned by the page (`useStoredOpen(BOARD_OPEN_KEY, true)`) because the splitter can collapse it too.
 */
export function BoardSection({
  projectId,
  open,
  onOpenChange,
  fill = false,
}: {
  projectId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The page gave the board a fixed-height region: stretch to it so the lists scroller fills the rest. */
  fill?: boolean;
}) {
  const t = useT(TEXT);
  const board = useBoard(projectId);
  const flip = () => onOpenChange(!open);
  const [filter, setFilter] = useState<CardFilter>(EMPTY_FILTER);
  const data = board.data;
  // null = no filter: the board keeps every card and drag and drop stays on.
  const visible = useMemo(() => {
    if (!data || !isFiltering(filter)) return null;
    const today = todayIso();
    return new Set(data.cards.filter((c) => matchesFilter(c, filter, today)).map((c) => c.id));
  }, [data, filter]);
  const title = board.data ? t.title(board.data.lists.length, board.data.cards.length) : t.board;

  return (
    <section className={`flex flex-col border-t bg-muted/40 pt-3 ${fill ? 'min-h-0 flex-1' : ''}`}>
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
      <div id="board-section-body" hidden={!open} className={fill ? 'flex min-h-0 flex-1 flex-col' : undefined}>
        {open && (
          <>
            {data && (
              <BoardFilters
                value={filter}
                onChange={setFilter}
                members={data.members}
                labels={data.labels}
                shown={visible ? visible.size : data.cards.length}
                total={data.cards.length}
              />
            )}
            <Board projectId={projectId} fill={fill} visible={visible} />
          </>
        )}
      </div>
    </section>
  );
}
