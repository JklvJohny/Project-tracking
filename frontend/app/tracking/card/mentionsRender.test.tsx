import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderMentions } from './mentions';

describe('renderMentions', () => {
  it('shows current name for known id and literal for unknown', () => {
    const users = new Map([[3, { name: 'Malee' }]]);
    const { container } = render(<p>{renderMentions('hi @[3] and @[99]!', users)}</p>);
    const chip = container.querySelector('[data-mention="3"]');
    expect(chip?.textContent).toBe('@Malee');
    expect(container.textContent).toBe('hi @Malee and @[99]!');
    expect(container.querySelector('[data-mention="99"]')).toBeNull();
  });
});
