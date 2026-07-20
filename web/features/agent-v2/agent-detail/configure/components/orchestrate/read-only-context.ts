import { createContext, use } from 'react'

export const AgentOrchestrateReadOnlyContext = createContext(false)

export function useAgentOrchestrateReadOnly() {
  return use(AgentOrchestrateReadOnlyContext)
}
