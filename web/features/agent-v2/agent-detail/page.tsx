'use client'

import type { AgentDetailSectionKey } from './section'
import { AgentAccessPage } from './access/page'
import { AgentConfigurePage } from './configure/page'
import { AgentLogsPage } from './logs/page'
import { AgentMonitoringPage } from './monitoring/page'

type AgentDetailPageProps = {
  agentId: string
  section: AgentDetailSectionKey
}

export function AgentDetailPage({
  agentId,
  section,
}: AgentDetailPageProps) {
  if (section === 'monitoring')
    return <AgentMonitoringPage agentId={agentId} />

  if (section === 'logs')
    return <AgentLogsPage agentId={agentId} />

  if (section === 'access')
    return <AgentAccessPage agentId={agentId} />

  if (section === 'configure')
    return <AgentConfigurePage agentId={agentId} />

  return null
}
