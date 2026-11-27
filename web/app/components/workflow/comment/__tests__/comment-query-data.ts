import type { GetAppsByAppIdWorkflowCommentsMentionUsersResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { QueryClient } from '@tanstack/react-query'
import type { UserProfile } from '../types'
import { consoleQuery } from '@/service/console'

/** Seeds the app's mentionable users the way the comment surfaces read them. */
export const seedMentionableUsers = (
  queryClient: QueryClient,
  users: UserProfile[],
  appId = 'app-1',
) =>
  queryClient.setQueryData(
    consoleQuery.apps.byAppId.workflow.comments.mentionUsers.get.queryKey({
      input: { params: { app_id: appId } },
    }),
    { users } as unknown as GetAppsByAppIdWorkflowCommentsMentionUsersResponse,
  )
