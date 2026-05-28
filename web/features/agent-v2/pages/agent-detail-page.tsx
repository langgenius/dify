'use client'

import { useTranslation } from 'react-i18next'
import { AgentAccessPage } from '../components/access/access-page'
import { AgentLogsPage } from '../components/logs/logs-page'
import { AgentMonitoringPage } from '../components/monitoring/monitoring-page'

type AgentDetailPageProps = {
  section: 'configure' | 'access' | 'logs' | 'monitoring'
}

export function AgentDetailPage({
  section,
}: AgentDetailPageProps) {
  const { t } = useTranslation('agentV2')

  if (section === 'monitoring')
    return <AgentMonitoringPage />

  if (section === 'logs')
    return <AgentLogsPage />

  if (section === 'access')
    return <AgentAccessPage />

  return (
    <section
      aria-label={t(`agentDetail.sections.${section}`)}
      className="h-full min-w-0 flex-1 bg-components-panel-bg-blur"
    />
  )
}
