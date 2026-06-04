'use client'

import { skipToken, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import { MemorySettings } from './components/memory-settings'

type AgentConfigurePageProps = {
  agentId: string
}

export function AgentConfigurePage({
  agentId,
}: AgentConfigurePageProps) {
  const { t } = useTranslation('agentV2')
  const agentQuery = useQuery(consoleQuery.agents.byAgentId.get.queryOptions({
    input: {
      params: {
        agent_id: agentId,
      },
    },
  }))
  const activeVersionId = agentQuery.data?.active_config_snapshot_id
  const versionDetailQuery = useQuery(consoleQuery.agents.byAgentId.versions.byVersionId.get.queryOptions({
    input: activeVersionId
      ? {
          params: {
            agent_id: agentId,
            version_id: activeVersionId,
          },
        }
      : skipToken,
  }))

  return (
    <section
      aria-label={t('agentDetail.sections.configure')}
      className="h-full min-w-0 flex-1 overflow-auto bg-components-panel-bg-blur px-4 py-6 sm:px-12"
    >
      <div className="mx-auto max-w-3xl">
        <MemorySettings
          isPending={agentQuery.isPending || (!!activeVersionId && versionDetailQuery.isPending)}
          memory={versionDetailQuery.data?.config_snapshot.memory}
        />
      </div>
    </section>
  )
}
