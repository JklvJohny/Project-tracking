import { createElement, type ReactNode } from 'react';

// The wire format of a mention is exactly `@[<userId>]` (the backend parses the same token).
const TOKEN = /@\[(\d+)\]/g;

/** Chips show the member's current name, so a rename needs no comment rewrite. */
export function renderMentions(body: string, users: Map<number, { name: string }>): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of body.matchAll(TOKEN)) {
    const user = users.get(Number(m[1]));
    if (!user) continue; // unknown id stays literal text
    if (m.index > last) out.push(body.slice(last, m.index));
    out.push(
      createElement(
        'span',
        { key: `${m.index}`, 'data-mention': m[1], className: 'rounded bg-primary/10 px-1 font-medium text-primary' },
        `@${user.name}`,
      ),
    );
    last = m.index + m[0].length;
  }
  if (last < body.length) out.push(body.slice(last));
  return out;
}

/** The `@partial` being typed right before the caret, or null. `@` must start a word and no token may be open. */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const m = /(?:^|\s)@([^\s@[\]]*)$/.exec(text.slice(0, caret));
  if (!m) return null;
  return { start: caret - m[1].length - 1, query: m[1] };
}

/** Puts the token at the caret (replacing a typed `@partial`) and a separating space after it. */
export function insertMention(text: string, caret: number, userId: number): { text: string; caret: number } {
  const q = mentionQuery(text, caret);
  const start = q ? q.start : caret;
  const token = `@[${userId}]`;
  const after = text.slice(caret);
  const gap = /^\s/.test(after) ? '' : ' ';
  return { text: text.slice(0, start) + token + gap + after, caret: start + token.length + 1 };
}
