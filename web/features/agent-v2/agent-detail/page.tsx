'use client'

import type { AgentDetailSectionKey } from './section'
import { useTranslation } from 'react-i18next'
import { AgentAccessPage } from './access/page'
import { MemorySettings } from './configure/memory-settings'
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

  if (section === 'configure') {
    return (
      <section
        aria-label={t('agentDetail.sections.configure')}
        className="h-full min-w-0 flex-1 overflow-auto bg-components-panel-bg-blur px-4 py-6 sm:px-12"
      >
        <div className="mx-auto max-w-3xl">
          <MemorySettings />
        </div>
      </section>
    )
  }

  return null
}
