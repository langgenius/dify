'use client'

import type { AgentRosterResponse } from '@dify/contracts/api/console/agents/types.gen'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import useTimestamp from '@/hooks/use-timestamp'

type AgentMetadataProps = {
  agent?: AgentRosterResponse
  isPending: boolean
}

type MetadataItem = {
  label: string
  value?: string | null
  translate?: 'no'
}

function MetadataValue({
  isPending,
  item,
}: {
  isPending: boolean
  item: MetadataItem
}) {
  const { t } = useTranslation('agentV2')

  return (
    <div className="min-w-0 rounded-lg border border-divider-subtle bg-background-section-burn p-3">
      <div className="system-xs-semibold-uppercase text-text-tertiary">
        {item.label}
      </div>
      {isPending
        ? <SkeletonRectangle className="mt-2 h-4 w-28 animate-pulse rounded-md" />
        : (
            <div
              className="mt-1 truncate system-sm-semibold text-text-primary"
              translate={item.translate}
            >
              {item.value || t('agentDetail.metadata.emptyValue')}
            </div>
          )}
    </div>
  )
}

export function AgentMetadata({
  agent,
  isPending,
}: AgentMetadataProps) {
  const { t } = useTranslation('agentV2')
  const { formatTime } = useTimestamp()
  const activeVersion = agent?.active_config_snapshot?.version
  const updatedAt = agent?.updated_at != null
    ? formatTime(agent.updated_at, t('roster.dateTimeFormat'))
    : null
  const items: MetadataItem[] = [
    {
      label: t('agentDetail.metadata.sourceLabel'),
      value: agent ? t(`roster.sources.${agent.source}`) : undefined,
    },
    {
      label: t('agentDetail.metadata.scopeLabel'),
      value: agent ? t(`agentDetail.metadata.scopes.${agent.scope}`) : undefined,
    },
    {
      label: t('agentDetail.metadata.statusLabel'),
      value: agent ? t(`roster.status.${agent.status}`) : undefined,
    },
    {
      label: t('agentDetail.metadata.activeVersionLabel'),
      value: activeVersion != null ? `v${activeVersion}` : null,
      translate: 'no',
    },
    {
      label: t('agentDetail.metadata.updatedAtLabel'),
      value: updatedAt,
      translate: 'no',
    },
    {
      label: t('agentDetail.metadata.appIdLabel'),
      value: agent?.app_id,
      translate: 'no',
    },
    {
      label: t('agentDetail.metadata.workflowIdLabel'),
      value: agent?.workflow_id,
      translate: 'no',
    },
    {
      label: t('agentDetail.metadata.workflowNodeIdLabel'),
      value: agent?.workflow_node_id,
      translate: 'no',
    },
  ]

  return (
    <div className="rounded-xl border border-components-panel-border bg-components-panel-bg p-4 shadow-xs">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-state-accent-hover text-text-accent-light-mode-only">
          <span aria-hidden className="i-ri-id-card-line size-5" />
        </div>
        <div className="min-w-0">
          <h2 className="system-xl-semibold text-text-primary">
            {t('agentDetail.metadata.title')}
          </h2>
          <p className="mt-1 system-sm-regular text-text-tertiary">
            {t('agentDetail.metadata.description')}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {items.map(item => (
          <MetadataValue
            key={item.label}
            isPending={isPending}
            item={item}
          />
        ))}
      </div>
    </div>
  )
}
