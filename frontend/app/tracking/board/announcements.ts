import type { Announcements, UniqueIdentifier } from '@dnd-kit/core';
import type { Lang } from '../shared/i18n';

/** Draggable ids are `card:<id>` / `list:<id>` so cards and lists never collide in one DndContext. */
export const cardDndId = (id: number) => `card:${id}`;
export const listDndId = (id: number) => `list:${id}`;

const TEXT = {
  th: {
    card: 'การ์ด',
    list: 'ลิสต์',
    start: (what: string) => `หยิบ${what}แล้ว ใช้ปุ่มลูกศรเพื่อย้าย กด Space เพื่อวาง กด Esc เพื่อยกเลิก`,
    over: (what: string, over: string) => `${what}อยู่เหนือ ${over}`,
    end: (what: string, over: string) => `วาง${what}ที่ ${over} แล้ว`,
    endFree: (what: string) => `วาง${what}แล้ว`,
    cancel: (what: string) => `ยกเลิกการย้าย${what}`,
  },
  en: {
    card: 'card',
    list: 'list',
    start: (what: string) => `Picked up ${what}. Use arrow keys to move, Space to drop, Escape to cancel`,
    over: (what: string, over: string) => `${what} is over ${over}`,
    end: (what: string, over: string) => `${what} dropped on ${over}`,
    endFree: (what: string) => `${what} dropped`,
    cancel: (what: string) => `Move of ${what} cancelled`,
  },
};

/** `name` resolves a dnd id to user content (card title / list name); falls back to the generic noun. */
export function announcements(lang: Lang, name?: (id: UniqueIdentifier) => string | undefined): Announcements {
  const t = TEXT[lang];
  const label = (id: UniqueIdentifier) => {
    const noun = String(id).startsWith('list:') ? t.list : t.card;
    const n = name?.(id);
    return n ? `${noun} ${n}` : noun;
  };
  return {
    onDragStart: ({ active }) => t.start(label(active.id)),
    onDragOver: ({ active, over }) => (over ? t.over(label(active.id), label(over.id)) : undefined),
    onDragEnd: ({ active, over }) => (over ? t.end(label(active.id), label(over.id)) : t.endFree(label(active.id))),
    onDragCancel: ({ active }) => t.cancel(label(active.id)),
  };
}
