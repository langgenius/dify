import type { WorkflowCommentReply } from '@dify/contracts/api/console/apps/types.gen'
import { v4 as uuid } from 'uuid'

/**
 * A reply as the thread holds it. A reply that is still sending has a local `pending-` id;
 * `client_key` keeps the row's React key stable once the server id replaces it.
 */
export type ThreadReply = WorkflowCommentReply & { client_key?: string }

const PENDING_PREFIX = 'pending-'

export const createPendingReplyId = () => `${PENDING_PREFIX}${uuid()}`

export const isPendingReply = (reply: ThreadReply) => reply.id.startsWith(PENDING_PREFIX)

export const getReplyKey = (reply: ThreadReply) => reply.client_key ?? reply.id

/**
 * Fetched replies keep the keys the thread already rendered them with. Replies sent from
 * here that the fetch does not have yet (still sending, or confirmed after the fetch
 * started) stay at the end, so a refetch never drops or remounts a row. Only a reply's
 * author can delete it, and that removes it here first, so nothing stale is kept.
 */
export const mergeFetchedReplies = (
  current: ThreadReply[],
  fetched: WorkflowCommentReply[],
): ThreadReply[] => {
  const fetchedIds = new Set(fetched.map((reply) => reply.id))
  const keys = new Map(
    current.flatMap((reply) => (reply.client_key ? [[reply.id, reply.client_key] as const] : [])),
  )
  return [
    ...fetched.map((reply) => {
      const clientKey = keys.get(reply.id)
      return clientKey ? { ...reply, client_key: clientKey } : reply
    }),
    ...current.filter((reply) => reply.client_key && !fetchedIds.has(reply.id)),
  ]
}
