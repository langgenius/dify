import type { WorkflowCommentReply } from '@dify/contracts/api/console/apps/types.gen'

/**
 * A reply as the thread shows it. A reply sent from here that the server does not have yet
 * comes from its send mutation and has a `send_state`. `client_key` is the React key a sent
 * reply was first rendered with, kept once the server's copy replaces it.
 */
export type ThreadReply = WorkflowCommentReply & {
  client_key?: string
  send_state?: 'pending' | 'failed'
}

export const getReplyKey = (reply: ThreadReply) => reply.client_key ?? reply.id

/**
 * Whether a saved reply is the one this thread sent. The backend has no idempotency key for
 * replies, so it is matched by author and text, saved no earlier than a minute before it was
 * sent; a send whose response was lost is recognized this way.
 */
export const isSavedAs = (sent: ThreadReply, saved: WorkflowCommentReply) =>
  saved.created_by === sent.created_by &&
  saved.content === sent.content &&
  (saved.created_at ?? 0) >= (sent.created_at ?? 0) - 60
