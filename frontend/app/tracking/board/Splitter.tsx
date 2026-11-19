'use client';
import { useCallback, useEffect, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { useT } from '../shared/i18n';

const KEY = 'pt-split';
const DEFAULT = 0.55;
const MIN = 0.2;
const MAX = 0.8;
const STEP = 0.05;
// Dragging past these edges collapses a section instead of squeezing it: near the top the Board folds away,
// near the bottom the Timeline does.
export const COLLAPSE_TOP = 0.08;
export const COLLAPSE_BOTTOM = 0.92;

const TEXT = {
  th: {
    label: 'ปรับขนาดบอร์ดและไทม์ไลน์',
    hint: 'ลากเพื่อปรับขนาด · ลากสุดขอบเพื่อพับ · ดับเบิลคลิกเพื่อรีเซ็ต',
    value: (b: number) => `บอร์ด ${b}%, ไทม์ไลน์ ${100 - b}%`,
  },
  en: {
    label: 'Resize board and timeline',
    hint: 'Drag to resize · drag to an edge to collapse · double-click to reset',
    value: (b: number) => `Board ${b}%, timeline ${100 - b}%`,
  },
};

const clamp = (v: number) => Math.round(Math.min(MAX, Math.max(MIN, v)) * 100) / 100;

/** Board's share of the split, remembered per viewer. Starts at the default so the server render matches. */
export function useSplit(): [number, (v: number) => void] {
  const [ratio, setRatio] = useState(DEFAULT);
  useEffect(() => {
    try {
      const v = parseFloat(localStorage.getItem(KEY) ?? '');
      // eslint-disable-next-line react-hooks/set-state-in-effect -- storage is only readable after mount
      if (Number.isFinite(v)) setRatio(clamp(v));
    } catch {
      /* storage unavailable: keep the default */
    }
  }, []);
  const set = useCallback((v: number) => {
    const next = clamp(v);
    setRatio(next);
    try {
      localStorage.setItem(KEY, String(next));
    } catch {
      /* storage unavailable: the ratio lasts for this visit only */
    }
  }, []);
  return [ratio, set];
}

/**
 * Horizontal drag handle between the Board and Timeline; `value` is the Board's share (0.2-0.8).
 * Dragging past COLLAPSE_TOP / COLLAPSE_BOTTOM (or ArrowUp at the minimum / ArrowDown at the maximum) calls
 * `onCollapse` with the section to fold. The stored ratio is left as it was, so reopening restores the split.
 */
export function Splitter({
  value,
  onChange,
  onCollapse,
  containerRef,
}: {
  value: number;
  onChange: (v: number) => void;
  onCollapse: (section: 'board' | 'timeline') => void;
  containerRef: RefObject<HTMLDivElement | null>;
}) {
  const t = useT(TEXT);
  const pct = Math.round(value * 100);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowUp' && value <= MIN) {
      e.preventDefault();
      onCollapse('board');
      return;
    }
    if (e.key === 'ArrowDown' && value >= MAX) {
      e.preventDefault();
      onCollapse('timeline');
      return;
    }
    const next =
      e.key === 'ArrowUp'
        ? value - STEP
        : e.key === 'ArrowDown'
          ? value + STEP
          : e.key === 'Home'
            ? MIN
            : e.key === 'End'
              ? MAX
              : e.key === 'Enter'
                ? 0.5
                : null;
    if (next === null) return;
    e.preventDefault();
    onChange(next);
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const box = containerRef.current?.getBoundingClientRect();
    if (!box || box.height <= 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture?.(e.pointerId)) return;
    const box = containerRef.current?.getBoundingClientRect();
    if (!box || box.height <= 0) return;
    const raw = (e.clientY - box.top) / box.height;
    if (raw <= COLLAPSE_TOP || raw >= COLLAPSE_BOTTOM) {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      onCollapse(raw <= COLLAPSE_TOP ? 'board' : 'timeline');
      return;
    }
    onChange(raw);
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation="horizontal"
      aria-label={t.label}
      aria-valuemin={20}
      aria-valuemax={80}
      aria-valuenow={pct}
      aria-valuetext={t.value(pct)}
      title={t.hint}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onDoubleClick={() => onChange(0.5)}
      className="group relative z-10 flex h-3 shrink-0 cursor-row-resize touch-none items-center justify-center border-t bg-muted/40 hover:bg-primary/10 focus-visible:bg-primary/10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
    >
      <span aria-hidden className="h-1 w-12 rounded-full bg-input group-hover:bg-primary group-focus-visible:bg-primary" />
    </div>
  );
}
