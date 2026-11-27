import type { QueryClient } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'

/** Every write to workflow comments: creating, editing, moving, resolving and replies. */
export const commentWriteKey = consoleQuery.apps.byAppId.workflow.comments.key({
  type: 'mutation',
})

export const appIdOfWrite = (variables: unknown) =>
  (variables as { params?: { app_id?: string } } | undefined)?.params?.app_id

/**
 * Whether a comment write from here is running for the app. While one is, a read of that
 * app's comments could land on the write's optimistic state, so reads wait for the reconcile
 * after it.
 */
export const isWritingComments = (client: QueryClient, appId: string) =>
  client.isMutating({
    mutationKey: commentWriteKey,
    predicate: (mutation) => appIdOfWrite(mutation.state.variables) === appId,
  }) > 0
