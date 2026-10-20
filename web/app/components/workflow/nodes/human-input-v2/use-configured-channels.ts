import type { ListChannelsResponse } from '@dify/contracts/api/console/workspace/types.gen'
import { useQuery } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'
import { HUMAN_INPUT_V2_DEBUG_CHANNELS } from './types'

const selectConfiguredChannels = ({ channels }: ListChannelsResponse) =>
  HUMAN_INPUT_V2_DEBUG_CHANNELS.filter((channel) =>
    channels.some((configured) =>
      configured.kind === 'email' ? channel === 'email' : configured.provider === channel,
    ),
  )

const useConfiguredChannels = () => {
  const query = useQuery(
    consoleQuery.workspace.current.humanInput.v2.channels.get.queryOptions({
      select: selectConfiguredChannels,
      retry: false,
    }),
  )
  return {
    channels: query.isError ? [] : (query.data ?? []),
    isPending: query.isPending,
    isError: query.isError,
    isSuccess: query.isSuccess,
    refetch: query.refetch,
  }
}

export default useConfiguredChannels
