'use client'

import type { AgentVersionFilter } from './filter'
import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { userProfileAtom } from '@/context/account-state'
import { consoleQuery } from '@/service/client'
import { CurrentDraftItem } from './current-draft-item'
import { VersionFilter } from './filter'
import { VersionFilterEmpty } from './version-filter-empty'
import { VersionItem } from './version-item'

type AgentPreviewVersionsPanelProps = {
  agentId: string
  activeVersionId?: string | null
  onSelectVersion: (versionId: string | null) => void
  onClose: () => void
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
  const userProfile = useAtomValue(userProfileAtom)
  const [filterValue, setFilterValue] = useState<AgentVersionFilter>('all')
  const versionsQuery = useQuery(
    consoleQuery.agent.byAgentId.versions.get.queryOptions({
      input: {
        params: {
          agent_id: agentId,
        },
      },
    }),
  )
  const versions = versionsQuery.data?.data ?? []
  const latestVersionId = versions[0]?.id
  const currentUserCreatedByValues = new Set(
    [userProfile.id, userProfile.name, userProfile.email].filter(Boolean),
  )
  const filteredVersions = versions.filter((version) => {
    if (filterValue === 'onlyYours')
      return !!version.created_by && currentUserCreatedByValues.has(version.created_by)

    return true
  })
  const isFiltering = filterValue !== 'all'

  const handleResetFilter = () => {
    setFilterValue('all')
  }

  return (
    <aside className="flex h-full w-[268px] shrink-0 flex-col rounded-l-lg bg-components-panel-bg shadow-xl shadow-shadow-shadow-5">
      <div className="flex shrink-0 items-center gap-2 pt-3 pr-3 pl-4">
        <h2 className="min-w-0 flex-1 truncate system-xl-semibold text-text-primary">
          {tWorkflow(($) => $['versionHistory.title'])}
        </h2>
        <VersionFilter filterValue={filterValue} onFilterChange={setFilterValue} />
        <div className="h-3.5 w-px shrink-0 bg-divider-regular" />
        <button
          type="button"
          aria-label={tCommon(($) => $['operation.close'])}
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
            {t(($) => $['agentDetail.versionHistory.empty'])}
          </div>
        )}
        {!versionsQuery.isPending && versions.length > 0 && (
          <div className="flex flex-col gap-px">
            <CurrentDraftItem
              isActive={!activeVersionId}
              isLast={filteredVersions.length === 0}
              onSelect={() => onSelectVersion(null)}
            />
            {filteredVersions.length === 0 && isFiltering && (
              <VersionFilterEmpty onReset={handleResetFilter} />
            )}
            {filteredVersions.map((version, index) => (
              <VersionItem
                key={version.id}
                version={version}
                activeVersionId={activeVersionId}
                isLatest={version.id === latestVersionId}
                isFirst={false}
                isLast={index === filteredVersions.length - 1}
                onSelect={onSelectVersion}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}
