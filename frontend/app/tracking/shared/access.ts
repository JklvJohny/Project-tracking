import type { components } from './api/schema';

type Board = components['schemas']['Board'];

/**
 * What the caller may do on a project's board. An archived project is read-only for everyone (the same gating as a
 * viewer); PM and admin keep one action, Restore. The server enforces the same rules (409 project_archived).
 */
export function boardAccess(b: Pick<Board, 'myRole' | 'project'> | undefined) {
  const role = b?.myRole;
  const manager = role === 'admin' || role === 'pm';
  const archived = !!b?.project.archivedAt;
  return {
    archived,
    /** Admin or PM, archived or not: sees the Members and Settings dialogs. */
    manager,
    canManage: manager && !archived,
    canEdit: (manager || role === 'member') && !archived,
    canRestore: manager && archived,
  };
}

/**
 * Who may tick or untick a card's checklist items (owner's rule, 2026-11-19): admin and PM on any card, a member only
 * on cards assigned to them, viewers never, nobody on an archived project. The server enforces the same rule (403).
 */
export function canTickCard(
  b: Pick<Board, 'myRole' | 'project'> | undefined,
  assigneeIds: readonly number[],
  meId: number | undefined,
): boolean {
  const { canEdit, manager } = boardAccess(b);
  if (!canEdit) return false;
  return manager || (meId !== undefined && assigneeIds.includes(meId));
}
