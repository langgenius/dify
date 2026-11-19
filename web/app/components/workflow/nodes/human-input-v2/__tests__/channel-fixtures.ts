import type { HumanInputTestChannelsResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { QueryClient } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'

export const createChannelsQueryClient = (
  channels: HumanInputTestChannelsResponse['channels'] = ['email', 'slack'],
) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  })
  queryClient.setQueryData(
    consoleQuery.workspaces.current.humanInput.v2.testChannels.get.queryKey(),
    { channels } satisfies HumanInputTestChannelsResponse,
  )
  return queryClient
}
