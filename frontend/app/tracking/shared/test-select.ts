import { fireEvent, screen } from '@testing-library/react';

/** jsdom lacks what Radix Select calls while opening; call once before a test opens one. */
export function polyfillRadixSelect() {
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
}

/** Opens a Radix Select by its trigger and picks the option with this accessible name. */
export async function pickOption(trigger: HTMLElement, name: string | RegExp) {
  polyfillRadixSelect();
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  fireEvent.click(await screen.findByRole('option', { name }));
}
