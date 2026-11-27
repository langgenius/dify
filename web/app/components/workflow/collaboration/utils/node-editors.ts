import type { Collaborator } from '../components/collaborator-avatar'
import type { NodePanelPresenceMap } from '../types/collaboration'
import { getUserColor } from './user-color'

/**
 * Other users who have this node's panel open, most recent first.
 * A user with several open clients is listed once, at their latest entry.
 */
export const getNodeEditors = (
  presence: NodePanelPresenceMap | undefined,
  nodeId: string,
  currentUserId: string,
): Collaborator[] => {
  const viewers = presence?.[nodeId]
  if (!viewers) return []

  const seen = new Set<string>()
  return Object.values(viewers)
    .filter((viewer) => viewer.userId && viewer.userId !== currentUserId)
    .sort((a, b) => b.timestamp - a.timestamp)
    .filter((viewer) => {
      if (seen.has(viewer.userId)) return false
      seen.add(viewer.userId)
      return true
    })
    .map((viewer) => ({
      id: viewer.userId,
      name: viewer.username,
      avatarUrl: viewer.avatar || null,
      color: getUserColor(viewer.userId),
    }))
}
