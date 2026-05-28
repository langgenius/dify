'use client'

import type { AgentDetailSectionKey } from './section'
import { useTranslation } from 'react-i18next'
import { AgentAccessPage } from './access/page'
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
  const { t } = useTranslation('agentV2')

  if (section === 'monitoring')
    return <AgentMonitoringPage />

  if (section === 'logs')
    return <AgentLogsPage />

  if (section === 'access')
    return <AgentAccessPage agentId={agentId} />

  return (
    <section
      aria-label={t(`agentDetail.sections.${section}`)}
      className="h-full min-w-0 flex-1 bg-components-panel-bg-blur"
    />
  )
}
