import { get } from './base'
import type {
  StrategyPluginDetail,
} from '@/app/components/plugins/types'
import { useInvalid } from './use-base'
import {
  useQuery,
} from '@tanstack/react-query'

const NAME_SPACE = 'agent-strategy'

const useStrategyListKey = [NAME_SPACE, 'strategyList']
export const useStrategyProviders = () => {
  return useQuery<StrategyPluginDetail[]>({
    queryKey: useStrategyListKey,
    queryFn: () => get<StrategyPluginDetail[]>('/workspaces/current/agent-providers'),
  })
}

export const useInvalidateStrategyProviders = () => {
  return useInvalid(useStrategyListKey)
}

export const useStrategyProviderDetail = (agentProvider: string) => {
  return useQuery<StrategyPluginDetail>({
    queryKey: [NAME_SPACE, 'detail', agentProvider],
    queryFn: () => get<StrategyPluginDetail>(`/workspaces/current/agent-providers/${agentProvider}`),
  })
}

export const useInvalidateStrategyProviderDetail = (agentProvider: string) => {
  return useInvalid([NAME_SPACE, 'detail', agentProvider])
}
