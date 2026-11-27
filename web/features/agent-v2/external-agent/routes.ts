export const getExternalAgentOverviewPath = (agentId: string) =>
  `/external-agent/${encodeURIComponent(agentId)}/overview`

export const getExternalAgentMonitoringPath = (agentId: string) =>
  `/external-agent/${encodeURIComponent(agentId)}/monitoring`
