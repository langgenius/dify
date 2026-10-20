import type {
  ChannelSummary,
  ListChannelsResponse,
} from '@dify/contracts/api/console/workspace/types.gen'
import { QueryClient } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'

export const createChannelsQueryClient = (
  providers: ChannelSummary['provider'][] = ['resend', 'slack'],
) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  })
  const channels: ChannelSummary[] = providers.map((provider) => ({
    id: `channel-${provider}`,
    kind: provider === 'resend' ? 'email' : 'im',
    provider,
    config_version: `version-${provider}`,
    created_at: 1,
    updated_at: 1,
    display_identifier: provider,
    status: provider === 'resend' ? 'configured' : 'connected',
    status_description: '',
    webhook_url: null,
  }))
  queryClient.setQueryData(
    consoleQuery.workspace.current.humanInput.v2.channels.get.queryOptions().queryKey,
    { channels } satisfies ListChannelsResponse,
  )
  return queryClient
}
