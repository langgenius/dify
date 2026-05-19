import type { WorkflowOnlineUser, WorkflowOnlineUsersResponse } from '@/models/app'
import { skipToken, useQuery } from '@tanstack/react-query'
import { consoleQuery } from '@/service/client'

type WorkflowOnlineUsersMap = Record<string, WorkflowOnlineUser[]>

type UseWorkflowOnlineUsersParams = {
  appIds: string[]
  enabled: boolean
}

const normalizeWorkflowOnlineUsers = (response?: WorkflowOnlineUsersResponse): WorkflowOnlineUsersMap => {
  const data = response?.data

  if (!data)
    return {}

  if (Array.isArray(data)) {
    return data.reduce<WorkflowOnlineUsersMap>((acc, item) => {
      if (item?.app_id)
        acc[item.app_id] = item.users || []
      return acc
    }, {})
  }

  return Object.entries(data).reduce<WorkflowOnlineUsersMap>((acc, [appId, users]) => {
    if (appId)
      acc[appId] = users || []
    return acc
  }, {})
}

export const useWorkflowOnlineUsers = ({
  appIds,
  enabled,
}: UseWorkflowOnlineUsersParams) => {
  const shouldFetch = enabled && appIds.length > 0
  const { data: onlineUsersMap = {} } = useQuery(consoleQuery.apps.workflowOnlineUsers.queryOptions({
    input: shouldFetch
      ? { body: { app_ids: appIds } }
      : skipToken,
    select: normalizeWorkflowOnlineUsers,
    refetchInterval: shouldFetch ? 10000 : false,
  }))

  return {
    onlineUsersMap,
  }
}
