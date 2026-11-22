import type { QueryClient } from '@tanstack/react-query'
import { noop } from 'es-toolkit/function'
import { consoleQuery } from '@/service/console'
import { isWritingComments } from './comment-writes'

type CommentParams = { app_id: string; comment_id: string }

/**
 * Reads a comment's thread before it opens, so it opens with its replies instead of filling
 * them in. A cached thread is enough, since opening one refreshes it over what is shown. Nothing
 * is read while a write to the app is running, and a failed read is left to the thread's own.
 */
export function prefetchCommentThread(client: QueryClient, params: CommentParams) {
  if (isWritingComments(client, params.app_id)) return
  void client
    .query({
      ...consoleQuery.apps.byAppId.workflow.comments.byCommentId.get.queryOptions({
        input: { params },
      }),
      staleTime: Infinity,
    })
    .catch(noop)
}
