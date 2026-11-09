import { useAtomValue } from 'jotai'
import { trackEvent } from '@/app/components/base/amplitude'
import { isChatflowAtom } from '@/app/components/workflow/editor-resource/state'

export type AgentScope = (typeof AgentScope)[keyof typeof AgentScope]
export const AgentScope = {
  InWorkflow: 'in_workflow',
  InChatflow: 'in_chatflow',
  Global: 'global',
} as const

export const useInlineAgentScope = () => {
  const isChatflow = useAtomValue(isChatflowAtom)

  return isChatflow ? AgentScope.InChatflow : AgentScope.InWorkflow
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
