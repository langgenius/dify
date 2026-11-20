import type { ListChannelsResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { HumanInputV2DebugChannel } from './types'
import { skipToken, useQuery } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'
import { HUMAN_INPUT_V2_DEBUG_CHANNELS } from './types'

const selectConfiguredChannels = ({ channels }: ListChannelsResponse) =>
  HUMAN_INPUT_V2_DEBUG_CHANNELS.filter((channel) =>
    channels.some((configured) =>
      configured.kind === 'email' ? channel === 'email' : configured.provider === channel,
    ),
  )

const useConfiguredChannels = () => {
  const features = useQuery(consoleQuery.features.get.queryOptions({ retry: false }))
  const centrallyManaged = features.data?.im_centrally_managed
  const query = useQuery(
    consoleQuery.workspaces.current.humanInput.v2.channels.get.queryOptions({
      input: features.isSuccess && !centrallyManaged ? undefined : skipToken,
      select: selectConfiguredChannels,
      retry: false,
    }),
  )
  // Workspace channel management is unavailable for centrally managed deployments.
  // Only advertise the delivery capability exposed to workspace editors.
  if (centrallyManaged || !features.isSuccess) {
    const channels: HumanInputV2DebugChannel[] =
      centrallyManaged && features.data?.human_input_email_delivery_enabled ? ['email'] : []
    return {
      channels,
      isPending: features.isPending,
      isError: features.isError,
      isSuccess: features.isSuccess,
      refetch: features.refetch,
    }
  }
  return {
    channels: query.isError ? [] : (query.data ?? []),
    isPending: query.isPending,
    isError: query.isError,
    isSuccess: query.isSuccess,
    refetch: query.refetch,
  }
}

export default useConfiguredChannels
