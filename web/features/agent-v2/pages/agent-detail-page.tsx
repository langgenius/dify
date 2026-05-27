'use client'

import { useTranslation } from 'react-i18next'
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

  return (
    <section
      aria-label={t(`agentDetail.sections.${section}`)}
      className="h-full min-w-0 flex-1 bg-background-section"
    />
  )
}
