'use client'

import type { AgentDetailSectionKey } from './section'
import { Button } from '@langgenius/dify-ui/button'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import { AgentAccessPage } from './access/page'
import { AgentConfigurePageLoading } from './configure/components/page-loading'
import { AgentConfigurePage } from './configure/page'
import { ExternalAgentConnectionPage } from './external-agent/page'
import { AgentLogsPage } from './logs/page'
import { AgentMonitoringPage } from './monitoring/page'
import { AgentDetailSectionSurface } from './section-surface'

type AgentDetailPageProps = {
  agentId: string
  section: AgentDetailSectionKey
}

function AgentConfigureRoute({ agentId }: { agentId: string }) {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const agentQuery = useQuery(
    consoleQuery.agent.byAgentId.get.queryOptions({
      input: { params: { agent_id: agentId } },
    }),
  )

  if (agentQuery.isPending)
    return <AgentConfigurePageLoading label={t(($) => $['agentDetail.sections.configure'])} />

  if (agentQuery.isError || !agentQuery.data) {
    return (
      <AgentDetailSectionSurface label={t(($) => $['agentDetail.sections.configure'])}>
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center">
          <div>
            <span aria-hidden className="i-ri-error-warning-line size-6 text-text-warning" />
            <p className="mt-2 system-sm-medium text-text-secondary">
              {t(($) => $['roster.loadingError'])}
            </p>
            <Button className="mt-3" onClick={() => void agentQuery.refetch()}>
              {tCommon(($) => $['operation.retry'])}
            </Button>
          </div>
        </div>
      </AgentDetailSectionSurface>
    )
  }

  if (agentQuery.data.agent_kind === 'external_agent')
    return <ExternalAgentConnectionPage agentId={agentId} />

  return <AgentConfigurePage agentId={agentId} />
}

export function AgentDetailPage({ agentId, section }: AgentDetailPageProps) {
  if (section === 'monitoring') return <AgentMonitoringPage agentId={agentId} />

  if (section === 'logs') return <AgentLogsPage agentId={agentId} />

  if (section === 'access') return <AgentAccessPage agentId={agentId} />

  if (section === 'configure') return <AgentConfigureRoute agentId={agentId} />

  return null
}
