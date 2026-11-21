import type { WorkflowCommentReply } from '@dify/contracts/api/console/apps/types.gen'
import { v4 as uuid } from 'uuid'

/**
 * A reply as the thread holds it. A reply sent from here that the server does not have yet
 * has a local id and a `send_state`; it keeps its mentions so it can be sent again.
 * `client_key` keeps the row's React key stable once the server id replaces the local one.
 */
export type ThreadReply = WorkflowCommentReply & {
  client_key?: string
  send_state?: 'pending' | 'failed'
  mentioned_user_ids?: string[]
}

export const createLocalReplyId = () => `local-${uuid()}`

export const getReplyKey = (reply: ThreadReply) => reply.client_key ?? reply.id

// The backend has no idempotency key for replies, so a reply this thread sent is matched
// to a saved one by author and text, saved no earlier than a minute before it was sent.
const isSavedAs = (local: ThreadReply, saved: WorkflowCommentReply) =>
  saved.created_by === local.created_by &&
  saved.content === local.content &&
  (saved.created_at ?? 0) >= (local.created_at ?? 0) - 60

/**
 * Fetched replies keep the keys the thread already rendered them with. Replies the server
 * does not have yet (sending or failed) stay at the end, unless the fetch shows the server
 * saved them after all, for example when a send's response was lost.
 */
export const mergeFetchedReplies = (
  current: ThreadReply[],
  fetched: WorkflowCommentReply[],
): ThreadReply[] => {
  const keys = new Map(
    current.flatMap((reply) => (reply.client_key ? [[reply.id, reply.client_key] as const] : [])),
  )
  return [
    ...fetched.map((reply) => {
      const clientKey = keys.get(reply.id)
      return clientKey ? { ...reply, client_key: clientKey } : reply
    }),
    ...current.filter(
      (reply) => reply.send_state && !fetched.some((saved) => isSavedAs(reply, saved)),
    ),
  ]
}
