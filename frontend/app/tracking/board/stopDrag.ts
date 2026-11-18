import type { SyntheticEvent } from 'react';

/** Pressing a control inside a card row must never start a drag from the row around it (pointer, touch or keyboard). */
export const stopDrag = {
  onPointerDown: (e: SyntheticEvent) => e.stopPropagation(),
  onTouchStart: (e: SyntheticEvent) => e.stopPropagation(),
  onKeyDown: (e: SyntheticEvent) => e.stopPropagation(),
};
