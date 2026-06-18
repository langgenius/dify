import type { AgentCliTool, AgentFileNode, AgentKnowledgeRetrievalItem, AgentSkill } from '@/features/agent-v2/agent-composer/form-state'
import { createContext, use, useCallback, useEffect, useRef } from 'react'

export type AgentOrchestrateAddActionKey = 'cli' | 'files' | 'knowledge' | 'skills'

export type AgentOrchestrateAddedItem = AgentCliTool | AgentFileNode | AgentKnowledgeRetrievalItem | AgentSkill

export type AgentOrchestrateAddActionOptions = {
  onAdded?: (item: AgentOrchestrateAddedItem) => void
}

export type AgentOrchestrateAddAction = (options?: AgentOrchestrateAddActionOptions) => void

export type AgentOrchestrateAddActions = Partial<Record<AgentOrchestrateAddActionKey, AgentOrchestrateAddAction>>

export type AgentOrchestrateAddActionsContextValue = {
  actions: AgentOrchestrateAddActions
  registerAction: (key: AgentOrchestrateAddActionKey, action: AgentOrchestrateAddAction) => () => void
}

export const AgentOrchestrateAddActionsContext = createContext<AgentOrchestrateAddActionsContextValue | null>(null)

export function useAgentOrchestrateAddActions() {
  const context = use(AgentOrchestrateAddActionsContext)
  if (!context)
    return {}

  return context.actions
}

export function useRegisterAgentOrchestrateAddAction(
  key: AgentOrchestrateAddActionKey,
  action: AgentOrchestrateAddAction,
) {
  const context = use(AgentOrchestrateAddActionsContext)
  const registerAction = context?.registerAction
  const actionRef = useRef(action)

  actionRef.current = action

  const stableAction = useCallback<AgentOrchestrateAddAction>((options) => {
    actionRef.current(options)
  }, [])

  useEffect(() => {
    if (!registerAction)
      return

    return registerAction(key, stableAction)
  }, [key, registerAction, stableAction])
}
