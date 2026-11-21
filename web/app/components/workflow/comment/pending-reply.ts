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
