import type { AgentDetailSectionKey } from './section'

export const getAgentDetailPath = (
  agentId: string,
  section: AgentDetailSectionKey,
) => `/roster/${agentId}/${section}`

export const getAgentIdFromPathname = (pathname: string) => {
  const [section, agentId] = pathname.split('/').filter(Boolean)

  if (section !== 'roster')
    return undefined

  return agentId
}
