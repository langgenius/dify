import type { StrategyPluginDetail } from '@/app/components/plugins/types'
import { get } from './base'

export const fetchStrategyList = () => {
  return get<StrategyPluginDetail[]>('/workspaces/current/agent-providers')
}

export const fetchStrategyDetail = (agentProvider: string) => {
  return get<StrategyPluginDetail>(`/workspaces/current/agent-provider/${agentProvider}`)
}
