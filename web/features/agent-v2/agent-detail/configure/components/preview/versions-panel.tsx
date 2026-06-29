'use client'

import type { AgentConfigSnapshotSummaryResponse } from '@dify/contracts/api/console/agent/types.gen'
import { cn } from '@langgenius/dify-ui/cn'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from '#i18n'
import useTimestamp from '@/hooks/use-timestamp'
import { consoleQuery } from '@/service/client'

type AgentPreviewVersionsPanelProps = {
  agentId: string
  activeVersionId?: string | null
  onSelectVersion: (versionId: string | null) => void
  onClose: () => void
}

function VersionTimelineDot({
  isActive,
  isFirst,
  isLast,
}: {
  isActive: boolean
  isFirst: boolean
  isLast: boolean
}) {
  return (
    <div className="relative flex w-[18px] shrink-0 justify-center pt-1.5">
      {!isFirst && <div className="absolute top-0 h-2 w-0.5 bg-divider-subtle" />}
      <span
        aria-hidden
        className={cn(
          'relative z-1 size-2 rounded-full border-2 bg-components-panel-bg',
          isActive ? 'border-text-accent' : 'border-text-quaternary',
        )}
      />
      {!isLast && <div className="absolute top-3 bottom-[-18px] w-0.5 bg-divider-subtle" />}
    </div>
  )
}

function VersionMetadata({
  version,
}: {
  version: AgentConfigSnapshotSummaryResponse
}) {
  const { t } = useTranslation('agentV2')
  const { formatTime } = useTimestamp()

  if (version.created_at == null && !version.created_by)
    return null

  return (
    <p className="truncate system-xs-regular text-text-tertiary">
      {version.created_at != null && formatTime(version.created_at, t('roster.dateTimeFormat'))}
      {version.created_at != null && version.created_by && ' · '}
      {version.created_by}
    </p>
  )
}

function VersionItem({
  version,
  activeVersionId,
  isLatest,
  isFirst,
  isLast,
  onSelect,
}: {
  version: AgentConfigSnapshotSummaryResponse
  activeVersionId?: string | null
  isLatest: boolean
  isFirst: boolean
  isLast: boolean
  onSelect: (versionId: string) => void
}) {
  const { t } = useTranslation('agentV2')
  const { t: tWorkflow } = useTranslation('workflow')
  const isActive = version.id === activeVersionId
  const label = version.version_note || t('agentDetail.versionHistory.versionName', { version: version.version })

  return (
    <button
      type="button"
      aria-current={isActive ? 'true' : undefined}
      onClick={() => onSelect(version.id)}
      className={cn(
        'group relative flex w-full items-start gap-1 rounded-lg py-1 pr-1.5 pl-2 text-left focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
        isActive ? 'bg-state-accent-active' : 'hover:bg-state-base-hover',
      )}
    >
      <VersionTimelineDot isActive={isActive} isFirst={isFirst} isLast={isLast} />
      <div className="min-w-0 flex-1 py-0.5">
        <div className="flex min-w-0 items-center gap-1">
          <p className={cn('truncate system-sm-semibold', isActive ? 'text-text-accent' : 'text-text-secondary')}>
            {label}
          </p>
          {isLatest && (
            <span className="shrink-0 rounded-[5px] border border-text-accent-secondary bg-components-badge-bg-dimm px-[5px] py-[3px] system-2xs-medium-uppercase text-text-accent-secondary">
              {tWorkflow('versionHistory.latest')}
            </span>
          )}
        </div>
        {isActive && version.summary && (
          <p className="mt-0.5 line-clamp-4 system-xs-regular text-text-secondary">
            {version.summary}
          </p>
        )}
        <VersionMetadata version={version} />
      </div>
    </button>
  )
}

function CurrentDraftItem({
  isActive,
  isLast,
  onSelect,
}: {
  isActive: boolean
  isLast: boolean
  onSelect: () => void
}) {
  const { t: tWorkflow } = useTranslation('workflow')

  return (
    <button
      type="button"
      aria-current={isActive ? 'true' : undefined}
      onClick={onSelect}
      className={cn(
        'flex w-full items-start gap-1 rounded-lg py-1 pr-1.5 pl-2 text-left focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
        isActive ? 'bg-state-accent-active' : 'hover:bg-state-base-hover',
      )}
    >
      <VersionTimelineDot isActive={isActive} isFirst isLast={isLast} />
      <div className="min-w-0 flex-1 py-1">
        <p className={cn('truncate system-sm-semibold', isActive ? 'text-text-accent' : 'text-text-secondary')}>
          {tWorkflow('versionHistory.currentDraft')}
        </p>
      </div>
    </button>
  )
}

export function AgentPreviewVersionsPanel({
  agentId,
  activeVersionId,
  onSelectVersion,
  onClose,
}: AgentPreviewVersionsPanelProps) {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const { t: tWorkflow } = useTranslation('workflow')
  const versionsQuery = useQuery(consoleQuery.agent.byAgentId.versions.get.queryOptions({
    input: {
      params: {
        agent_id: agentId,
      },
    },
  }))
  const versions = versionsQuery.data?.data ?? []
  const latestVersionId = versions[0]?.id

  return (
    <aside className="flex h-full w-[268px] shrink-0 flex-col rounded-l-lg bg-components-panel-bg shadow-xl shadow-shadow-shadow-5">
      <div className="flex shrink-0 items-center gap-2 pt-3 pr-3 pl-4">
        <h2 className="min-w-0 flex-1 truncate system-xl-semibold text-text-primary">
          {tWorkflow('versionHistory.title')}
        </h2>
        <button
          type="button"
          aria-label={t('agentDetail.versionHistory.filter')}
          className="flex size-6 shrink-0 items-center justify-center rounded-md p-0.5 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
        >
          <span aria-hidden className="i-ri-filter-3-line size-4" />
        </button>
        <div className="h-3.5 w-px shrink-0 bg-divider-regular" />
        <button
          type="button"
          aria-label={tCommon('operation.close')}
          onClick={onClose}
          className="flex size-6 shrink-0 items-center justify-center rounded-md p-0.5 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
        >
          <span aria-hidden className="i-ri-close-line size-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {versionsQuery.isPending && (
          <div className="space-y-1">
            <div className="h-10 animate-pulse rounded-lg bg-state-base-hover" />
            <div className="h-18 animate-pulse rounded-lg bg-state-base-hover" />
            <div className="h-10 animate-pulse rounded-lg bg-state-base-hover" />
          </div>
        )}
        {!versionsQuery.isPending && versions.length === 0 && (
          <div className="rounded-lg border border-components-panel-border bg-components-panel-on-panel-item-bg px-3 py-6 text-center system-sm-regular text-text-tertiary">
            {t('agentDetail.versionHistory.empty')}
          </div>
        )}
        {!versionsQuery.isPending && versions.length > 0 && (
          <div className="flex flex-col gap-px">
            <CurrentDraftItem
              isActive={!activeVersionId}
              isLast={versions.length === 0}
              onSelect={() => onSelectVersion(null)}
            />
            {versions.map((version, index) => (
              <VersionItem
                key={version.id}
                version={version}
                activeVersionId={activeVersionId}
                isLatest={version.id === latestVersionId}
                isFirst={false}
                isLast={index === versions.length - 1}
                onSelect={onSelectVersion}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}
