import type { HumanInputTestChannelsResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { useQuery } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'
import { HUMAN_INPUT_V2_DEBUG_CHANNELS } from './types'

const selectConfiguredChannels = ({ channels }: HumanInputTestChannelsResponse) =>
  HUMAN_INPUT_V2_DEBUG_CHANNELS.filter((channel) => channels.includes(channel))

const useConfiguredChannels = () => {
  const query = useQuery(
    consoleQuery.workspaces.current.humanInput.v2.testChannels.get.queryOptions({
      select: selectConfiguredChannels,
      retry: false,
    }),
  )
  return {
    channels: query.isError ? [] : (query.data ?? []),
    isPending: query.isPending && query.fetchStatus !== 'idle',
    isError: query.isError,
    isSuccess: query.isSuccess,
    refetch: query.refetch,
  }
}

export default useConfiguredChannels
