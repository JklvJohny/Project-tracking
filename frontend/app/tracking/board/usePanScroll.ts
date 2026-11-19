'use client';
import { useRef, type PointerEvent } from 'react';

/**
 * Click-and-drag horizontal panning for the board, like Trello: pressing the mouse on empty board space (the gaps
 * between lists, or the area under a short list) and dragging scrolls the lists sideways.
 * Only presses on the scroller itself start a pan, so dragging cards and lists (dnd-kit) and clicking controls
 * inside a list are untouched. Mouse only: touch and pen already scroll natively.
 */
export function usePanScroll() {
  const pan = useRef<{ x: number; left: number; id: number } | null>(null);

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || e.target !== e.currentTarget) return;
    const el = e.currentTarget;
    if (el.scrollWidth <= el.clientWidth) return;
    // No text selection while panning.
    e.preventDefault();
    pan.current = { x: e.clientX, left: el.scrollLeft, id: e.pointerId };
    el.setPointerCapture?.(e.pointerId);
    el.dataset.panning = 'true';
  };
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const p = pan.current;
    if (!p || p.id !== e.pointerId) return;
    e.currentTarget.scrollLeft = p.left - (e.clientX - p.x);
  };
  const end = (e: PointerEvent<HTMLElement>) => {
    if (!pan.current || pan.current.id !== e.pointerId) return;
    pan.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    delete e.currentTarget.dataset.panning;
  };
  return { onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end };
}
