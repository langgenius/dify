import { useStore as useAppStore } from '@/app/components/app/store'
import { trackEvent } from '@/app/components/base/amplitude'
import { AppModeEnum } from '@/types/app'

export type AgentScope = (typeof AgentScope)[keyof typeof AgentScope]
export const AgentScope = {
  InWorkflow: 'in_workflow',
  InChatflow: 'in_chatflow',
  Global: 'global',
} as const

export const useInlineAgentScope = () => {
  const appMode = useAppStore((state) => state.appDetail?.mode)

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
