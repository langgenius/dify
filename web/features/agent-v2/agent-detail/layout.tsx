'use client'

import type {
  AgentConfigSnapshotSummaryResponse,
  AgentRosterResponse,
} from '@dify/contracts/api/console/agents/types.gen'
import type { ReactNode } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { ScrollArea } from '@langgenius/dify-ui/scroll-area'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import useDocumentTitle from '@/hooks/use-document-title'
import { consoleQuery } from '@/service/client'

type AgentDetailLayoutProps = {
  agentId: string
  children: ReactNode
}

function AgentIcon({ agent }: { agent?: AgentRosterResponse }) {
  return (
    <div
      className={cn(
        'flex size-10 shrink-0 items-center justify-center rounded-xl text-text-primary-on-surface shadow-xs',
        !agent?.icon_background && 'bg-text-accent',
      )}
      style={agent?.icon_background ? { backgroundColor: agent.icon_background } : undefined}
    >
      {agent?.icon_type === 'emoji' && agent.icon
        ? <span aria-hidden className="text-xl leading-none">{agent.icon}</span>
        : <span aria-hidden className="i-custom-vender-solid-mediaAndDevices-robot size-5" />}
    </div>
  )
}

export function AgentDetailLayout({
  agentId,
  children,
}: AgentDetailLayoutProps) {
  const { t } = useTranslation('agentV2')
  const [showVersionHistory, setShowVersionHistory] = useState(false)
  const agentQuery = useQuery(consoleQuery.agents.byAgentId.get.queryOptions({
    input: {
      params: {
        agent_id: agentId,
      },
    },
  }))
  const versionsQuery = useQuery({
    ...consoleQuery.agents.byAgentId.versions.get.queryOptions({
      input: {
        params: {
          agent_id: agentId,
        },
      },
    }),
    enabled: showVersionHistory,
  })
  const agent = agentQuery.data

  useDocumentTitle(agent?.name ?? t('agentDetail.documentTitle'))

  return (
    <main className="relative flex h-full min-w-0 flex-col overflow-hidden bg-components-panel-bg-blur">
      <header className="flex h-20 shrink-0 items-center justify-between border-b border-divider-subtle bg-components-panel-bg-blur px-6">
        <div className="flex min-w-0 items-center gap-3">
          <AgentIcon agent={agent} />
          <div className="min-w-0">
            <h1 className="truncate title-xl-semi-bold text-text-primary">
              {agent?.name ?? t('agentDetail.title')}
            </h1>
            <p className="mt-1 truncate system-xs-regular text-text-tertiary">
              {t('agentDetail.subtitle', { agentId })}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="primary"
            disabled
            aria-label={`${t('agentDetail.publish')} · ${t('agentDetail.publishSoon')}`}
            title={`${t('agentDetail.publish')} · ${t('agentDetail.publishSoon')}`}
            className="min-w-40 gap-2 py-2 pr-2 pl-3"
          >
            <span aria-hidden className="i-ri-upload-cloud-2-line size-4" />
            <span>
              {t('agentDetail.publish')}
            </span>
            <span className="rounded-[5px] bg-components-badge-bg-dimm px-1.5 py-0.5 system-2xs-medium-uppercase text-text-tertiary">
              {t('agentDetail.publishSoon')}
            </span>
          </Button>
          <Button
            variant="secondary"
            className={cn(
              'size-8 px-0! text-text-tertiary hover:text-text-secondary',
              showVersionHistory && 'border-components-button-secondary-border-hover bg-components-button-secondary-bg-hover text-text-secondary',
            )}
            aria-label={t('common.versionHistory', { ns: 'workflow' })}
            onClick={() => setShowVersionHistory(true)}
          >
            <span aria-hidden className="i-ri-history-line size-4" />
          </Button>
        </div>
      </header>
      <div className="min-h-0 min-w-0 flex-1 overflow-auto">
        {children}
      </div>
      {showVersionHistory && (
        <AgentVersionHistoryPanel
          activeVersionId={agent?.active_config_snapshot_id}
          isPending={versionsQuery.isPending}
          versions={versionsQuery.data?.data ?? []}
          onClose={() => setShowVersionHistory(false)}
        />
      )}
    </main>
  )
}

function AgentVersionHistoryPanel({
  activeVersionId,
  isPending,
  versions,
  onClose,
}: {
  activeVersionId?: string | null
  isPending: boolean
  versions: AgentConfigSnapshotSummaryResponse[]
  onClose: () => void
}) {
  const { t } = useTranslation('agentV2')

  return (
    <aside className="absolute top-20 right-0 bottom-0 flex w-67 flex-col rounded-l-2xl border-y-[0.5px] border-l-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xl shadow-shadow-shadow-5">
      <div className="flex items-center gap-x-2 px-4 pt-3">
        <div className="flex-1 py-1 system-xl-semibold text-text-primary">
          {t('versionHistory.title', { ns: 'workflow' })}
        </div>
        <button
          type="button"
          aria-label={t('operation.close', { ns: 'common' })}
          className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md p-0.5 hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          onClick={onClose}
        >
          <span aria-hidden className="i-ri-close-line size-4 text-text-tertiary" />
        </button>
      </div>
      <ScrollArea
        className="min-h-0 flex-1 overflow-hidden"
        label={t('versionHistory.title', { ns: 'workflow' })}
        slotClassNames={{
          viewport: 'overscroll-contain',
          content: 'min-h-full px-3 py-2',
          scrollbar: 'data-[orientation=vertical]:my-1 data-[orientation=vertical]:me-1',
        }}
      >
        <div className="space-y-2">
          {isPending && (
            <>
              <div className="h-18 animate-pulse rounded-lg bg-state-base-hover" />
              <div className="h-18 animate-pulse rounded-lg bg-state-base-hover" />
              <div className="h-18 animate-pulse rounded-lg bg-state-base-hover" />
            </>
          )}
          {!isPending && versions.length === 0 && (
            <div className="rounded-lg border border-components-panel-border bg-components-panel-on-panel-item-bg px-3 py-6 text-center system-sm-regular text-text-tertiary">
              {t('agentDetail.versionHistory.empty')}
            </div>
          )}
          {!isPending && versions.map(version => (
            <div
              key={version.id}
              className={cn(
                'rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg p-3 shadow-xs shadow-shadow-shadow-3',
                version.id === activeVersionId && 'border-effects-highlight bg-state-accent-hover',
              )}
            >
              <div className="flex min-w-0 items-center gap-2">
                <div className="shrink-0 rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1.5 py-0.5 system-2xs-medium-uppercase text-text-tertiary">
                  v
                  {version.version}
                </div>
                {version.id === activeVersionId && (
                  <div className="shrink-0 rounded-[5px] bg-state-accent-solid px-1.5 py-0.5 system-2xs-medium-uppercase text-text-primary-on-surface">
                    {t('agentDetail.versionHistory.active')}
                  </div>
                )}
              </div>
              {version.version_note && (
                <div className="mt-2 line-clamp-2 system-sm-medium text-text-primary">
                  {version.version_note}
                </div>
              )}
              {version.summary && (
                <div className="mt-1 line-clamp-2 system-xs-regular text-text-tertiary">
                  {version.summary}
                </div>
              )}
              {version.created_at && (
                <div className="mt-2 truncate system-xs-regular text-text-tertiary">
                  {version.created_at}
                </div>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>
    </aside>
  )
}
