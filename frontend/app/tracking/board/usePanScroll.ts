'use client';
import { useCallback, useRef, type PointerEvent } from 'react';

const LINE = 16;

/** True when `target` sits inside an element (below `root`) that scrolls vertically, such as a long list. */
function insideVerticalScroller(target: EventTarget | null, root: HTMLElement): boolean {
  for (let el = target instanceof Element ? target : null; el && el !== root; el = el.parentElement) {
    if (el.scrollHeight > el.clientHeight + 1) {
      const y = getComputedStyle(el).overflowY;
      if (y === 'auto' || y === 'scroll') return true;
    }
  }
  return false;
}

/**
 * Sideways scrolling for the board without a visible scrollbar, like Trello:
 * - Click-and-drag: pressing the mouse on empty board space (the gaps between lists, or the area under a short list)
 *   and dragging scrolls the lists sideways. Only presses on the scroller itself start a pan, so dragging cards and
 *   lists (dnd-kit) and clicking controls inside a list are untouched. Mouse only: touch and pen scroll natively.
 * - Mouse wheel: a vertical wheel turns into a sideways scroll, except over a list that scrolls on its own (the wheel
 *   then scrolls that list). Trackpad sideways swipes, Shift+wheel and Ctrl+wheel (zoom) keep their native behaviour.
 * Returns pointer handlers plus a ref; the wheel listener must be non-passive, so it is attached through the ref.
 */
export function usePanScroll() {
  const pan = useRef<{ x: number; left: number; id: number } | null>(null);
  const detach = useRef<(() => void) | null>(null);

  const ref = useCallback((el: HTMLElement | null) => {
    detach.current?.();
    detach.current = null;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.shiftKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
      if (el.scrollWidth <= el.clientWidth || insideVerticalScroller(e.target, el)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaMode === 1 ? e.deltaY * LINE : e.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    detach.current = () => el.removeEventListener('wheel', onWheel);
  }, []);

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
  return { ref, onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end };
}
