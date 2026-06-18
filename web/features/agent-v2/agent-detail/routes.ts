import type { AgentDetailSectionKey } from './section'

export const getAgentDetailPath = (
  agentId: string,
  section: AgentDetailSectionKey,
) => `/roster/agent/${agentId}/${section}`

export const getAgentIdFromPathname = (pathname: string) => {
  const [section, type, agentId] = pathname.split('/').filter(Boolean)

  if (section !== 'roster' || type !== 'agent')
    return undefined

  return agentId
}
