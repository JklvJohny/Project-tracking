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
