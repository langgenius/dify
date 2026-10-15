import { skipToken, useQuery } from '@tanstack/react-query'
import { trackEvent } from '@/app/components/base/amplitude'
import { useParams } from '@/next/navigation'
import { consoleQuery } from '@/service/console'

export type AgentScope = (typeof AgentScope)[keyof typeof AgentScope]
export const AgentScope = {
  InWorkflow: 'in_workflow',
  InChatflow: 'in_chatflow',
  Global: 'global',
} as const

export const useInlineAgentScope = () => {
  const { appId } = useParams<{ appId?: string }>()
  const { data: appMode } = useQuery(
    consoleQuery.apps.byAppId.get.queryOptions({
      input: appId ? { params: { app_id: appId } } : skipToken,
      select: (appDetail) => appDetail.mode,
    }),
  )

  return appMode === 'advanced-chat' ? AgentScope.InChatflow : AgentScope.InWorkflow
}

export const trackAgentBuildModeRun = (agentScope: AgentScope) => {
  return trackEvent('agent_build_mode_run', {
    agent_scope: agentScope,
  })
}

export const trackAgentPreviewModeRun = (agentScope: AgentScope) => {
  return trackEvent('agent_preview_mode_run', {
    agent_scope: agentScope,
  })
}
