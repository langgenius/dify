import type { AgentDetailSectionKey } from './section'

export const getAgentDetailPath = (agentId: string, section: AgentDetailSectionKey) =>
  `/agents/${agentId}/${section}`

export const getAgentIdFromPathname = (pathname: string) => {
  const [section, agentId] = pathname.split('/').filter(Boolean)

  if (section !== 'agents') return undefined

  return agentId
}
