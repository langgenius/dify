import { skipToken, useQuery } from '@tanstack/react-query'
import { trackEvent } from '@/app/components/base/amplitude'
import { useStore } from '@/app/components/workflow/store'
import { consoleQuery } from '@/service/console'
import { AppModeEnum } from '@/types/app'

export type AgentScope = (typeof AgentScope)[keyof typeof AgentScope]
export const AgentScope = {
  InWorkflow: 'in_workflow',
  InChatflow: 'in_chatflow',
  Global: 'global',
} as const

export const useInlineAgentScope = () => {
  const appId = useStore((state) => state.appId)
  const { data: appMode } = useQuery(
    consoleQuery.apps.byAppId.get.queryOptions({
      input: appId ? { params: { app_id: appId } } : skipToken,
      select: (app) => app.mode,
    }),
  )

  return appMode === AppModeEnum.ADVANCED_CHAT ? AgentScope.InChatflow : AgentScope.InWorkflow
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
