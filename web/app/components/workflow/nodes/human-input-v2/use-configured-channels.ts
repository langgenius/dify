import type { HumanInputTestChannelsResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { useQuery } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'
import { useOwnedQueryError } from '@/service/use-owned-query-error'
import { HUMAN_INPUT_V2_DEBUG_CHANNELS } from './types'

const selectConfiguredChannels = ({ channels }: HumanInputTestChannelsResponse) =>
  HUMAN_INPUT_V2_DEBUG_CHANNELS.filter((channel) => channels.includes(channel))

const useConfiguredChannels = (
  /** Whether the caller renders a failed load, such as an open channel popover. */
  shown = true,
) => {
  const query = useQuery(
    consoleQuery.workspaces.current.humanInput.v2.testChannels.get.queryOptions({
      select: selectConfiguredChannels,
      retry: false,
    }),
  )
  // The caller renders a failed first load with a retry; a failed refetch keeps the channels.
  const load = useOwnedQueryError(query, shown)
  return {
    channels: query.data ?? [],
    isPending: query.isPending && query.fetchStatus !== 'idle',
    isSuccess: query.isSuccess,
    load,
  }
}

export default useConfiguredChannels
