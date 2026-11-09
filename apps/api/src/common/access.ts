import { RequestUser } from './decorators/current-user.decorator';

/** Shared visibility rules (used by tasks, files and realtime so they can never drift apart). */
export function canSeeTask(
  me: Pick<RequestUser, 'id' | 'role' | 'teamId'>,
  task: { ownerId: string; teamId: string | null; collaborators?: Array<{ userId: string }> },
): boolean {
  if (me.role === 'ADMIN' || me.role === 'TEAM_LEAD') return true;
  if (task.ownerId === me.id) return true;
  if (task.collaborators?.some((c) => c.userId === me.id)) return true;
  if (me.role === 'COORDINATOR' && me.teamId && task.teamId === me.teamId) return true;
  return false;
}

export interface ChannelAccessInfo {
  type?: string;
  teamId: string | null;
  batchId?: string | null;
  createdById?: string;
  memberIds?: string[];
  batchLeadId?: string | null;
  batchCoordinatorId?: string | null;
}

/**
 * Company channels (type COMPANY) are open to everyone; team channels to that team plus leads/admins;
 * batch channels to the batch members, its lead/coordinator and admins; groups/DMs only to their members.
 */
export function canSeeChannel(
  me: Pick<RequestUser, 'id' | 'role' | 'teamId' | 'batchId'>,
  ch: ChannelAccessInfo,
): boolean {
  const type = ch.type ?? (ch.teamId ? 'TEAM' : 'COMPANY');
  if (type === 'GROUP' || type === 'DM') {
    // Private by design: even admins only see groups/DMs they are members of.
    return ch.createdById === me.id || !!ch.memberIds?.includes(me.id);
  }
  if (me.role === 'ADMIN') return true;
  if (type === 'COMPANY') return true;
  if (type === 'TEAM') return me.role === 'TEAM_LEAD' ? true : !!ch.teamId && me.teamId === ch.teamId;
  if (type === 'BATCH') {
    if (!ch.batchId) return false;
    if (me.batchId && me.batchId === ch.batchId) return true;
    return ch.batchLeadId === me.id || ch.batchCoordinatorId === me.id;
  }
  return false;
}
