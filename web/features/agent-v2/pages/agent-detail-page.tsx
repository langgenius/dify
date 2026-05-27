'use client'

import { useTranslation } from 'react-i18next'

type AgentDetailPageProps = {
  section: 'configure' | 'access' | 'logs' | 'annotation' | 'monitoring'
}

export function AgentDetailPage({
  section,
}: AgentDetailPageProps) {
  const { t } = useTranslation('agentV2')

  return (
    <section
      aria-label={t(`agentDetail.sections.${section}`)}
      className="h-full min-w-0 flex-1 bg-background-section"
    />
  )
}
