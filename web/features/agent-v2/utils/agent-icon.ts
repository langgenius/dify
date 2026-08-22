export type AgentIconSource = {
  icon_type?: string | null
  icon?: string | null
  icon_url?: string | null
}

export function getAgentAppIconImageUrl(agent: AgentIconSource): string | undefined {
  if (agent.icon_type === 'image') return agent.icon_url ?? undefined
  if (agent.icon_type === 'link') return agent.icon ?? undefined

  return undefined
}
