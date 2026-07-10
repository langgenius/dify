'use client'

import { ScrollArea } from '@langgenius/dify-ui/scroll-area'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useDocLink } from '@/context/i18n'
import { consoleQuery } from '@/service/client'
import { AgentDetailSectionSurface } from '../section-surface'
import { ServiceApiAccessCard } from './components/service-api-access-card'
import { WebAppAccessCard } from './components/web-app-access-card'
import { WorkflowReferencesTable } from './components/workflow-references-table'

type AgentAccessPageProps = {
  agentId: string
}

export function AgentAccessPage({
  agentId,
}: AgentAccessPageProps) {
  const { t } = useTranslation('agentV2')
  const docLink = useDocLink()
  const agentQuery = useQuery(consoleQuery.agent.byAgentId.get.queryOptions({
    input: {
      params: {
        agent_id: agentId,
      },
    },
  }))

  return (
    <AgentDetailSectionSurface label={t($ => $['agentDetail.sections.access'])}>
      <header className="h-15.5 shrink-0 px-6 pt-3 pb-2">
        <div className="min-w-0">
          <h2 className="system-xl-semibold text-text-primary">
            {t($ => $['agentDetail.access.title'])}
          </h2>
          <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-0.5 system-xs-regular text-text-tertiary">
            <span>{t($ => $['agentDetail.access.description'])}</span>
            <a
              href={docLink('/use-dify/publish/webapp/web-app-settings')}
              target="_blank"
              rel="noreferrer"
              className="inline-flex shrink-0 items-center gap-0.5 rounded-sm text-text-accent hover:underline focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
            >
              {t($ => $['agentDetail.access.learnMore'])}
              <span aria-hidden className="i-ri-external-link-line size-3" />
            </a>
          </p>
        </div>
      </header>

      <ScrollArea
        className="min-h-0 flex-1 overflow-hidden"
        slotClassNames={{
          content: 'px-6 pt-2 pb-8',
        }}
      >
        <div className="w-full min-w-0 space-y-6">
          <div className="grid w-full grid-cols-1 gap-3 xl:grid-cols-2">
            <WebAppAccessCard agent={agentQuery.data} agentId={agentId} isLoading={agentQuery.isPending} />
            <ServiceApiAccessCard agentId={agentId} />
          </div>

          <section aria-labelledby="agent-workflow-access-title">
            <div className="mb-3">
              <h3 id="agent-workflow-access-title" className="system-md-semibold text-text-primary">
                {t($ => $['agentDetail.access.workflow.title'])}
              </h3>
              <p className="mt-0.5 system-xs-regular text-text-tertiary">
                {t($ => $['agentDetail.access.workflow.description'])}
              </p>
            </div>

            <WorkflowReferencesTable agentId={agentId} enabled={agentQuery.isSuccess} />
          </section>
        </div>
      </ScrollArea>
    </AgentDetailSectionSurface>
  )
}
