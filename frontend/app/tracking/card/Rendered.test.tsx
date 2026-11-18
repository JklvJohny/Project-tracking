import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Rendered } from './Rendered';

afterEach(cleanup);
const users = new Map([[3, { name: 'Malee' }]]);

describe('Rendered', () => {
  it('a re-render keeps the same DOM nodes (no remount, selection survives)', () => {
    const { container, rerender } = render(<Rendered source={'hi @[3]\n\n- one'} users={users} />);
    const p = container.querySelector('p');
    const li = container.querySelector('li');
    rerender(<Rendered source={'hi @[3]\n\n- one'} users={users} />);
    expect(container.querySelector('p')).toBe(p);
    expect(container.querySelector('li')).toBe(li);
  });

  it('a markdown image is never loaded: it becomes a link with its alt text', () => {
    const { container } = render(<Rendered source="![pixel](https://evil.example/p.gif)" />);
    expect(container.querySelector('img')).toBeNull();
    const a = container.querySelector('a');
    expect(a?.getAttribute('href')).toBe('https://evil.example/p.gif');
    expect(a?.textContent).toBe('pixel');
    expect(a?.getAttribute('rel')).toBe('noopener noreferrer');
  });
});
