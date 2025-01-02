import type {
  StrategyPluginDetail,
} from '@/app/components/plugins/types'
import { useInvalid } from './use-base'
import {
  useQuery,
} from '@tanstack/react-query'
import { fetchStrategyDetail, fetchStrategyList } from './strategy'

const NAME_SPACE = 'agent_strategy'

const useStrategyListKey = [NAME_SPACE, 'strategyList']
export const useStrategyProviders = () => {
  return useQuery<StrategyPluginDetail[]>({
    queryKey: useStrategyListKey,
    queryFn: fetchStrategyList,
  })
}

export const useInvalidateStrategyProviders = () => {
  return useInvalid(useStrategyListKey)
}

export const useStrategyProviderDetail = (agentProvider: string) => {
  return useQuery<StrategyPluginDetail>({
    queryKey: [NAME_SPACE, 'detail', agentProvider],
    queryFn: () => fetchStrategyDetail(agentProvider),
    enabled: !!agentProvider,
  })
}

export const useInvalidateStrategyProviderDetail = (agentProvider: string) => {
  return useInvalid([NAME_SPACE, 'detail', agentProvider])
}
