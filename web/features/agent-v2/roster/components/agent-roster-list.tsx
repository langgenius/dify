'use client'

import type { AgentRosterResponse } from '@dify/contracts/api/console/agents/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import useTimestamp from '@/hooks/use-timestamp'
import Link from '@/next/link'
import { ArchiveAgentButton } from './archive-agent-button'
import { EditAgentDialog } from './edit-agent-dialog'

type AgentRosterListProps = {
  agents: AgentRosterResponse[]
  hasMore: boolean
  isEmptySearch: boolean
  isError: boolean
  isFetching: boolean
  isFetchingNextPage: boolean
  isPending: boolean
  onLoadMore: () => void
}

const getSourceLabelKey = (source: AgentRosterResponse['source']) => `roster.sources.${source}` as const

const skeletonRows = ['primary', 'secondary', 'tertiary'] as const

function AgentRosterSkeleton() {
  return (
    <>
      {skeletonRows.map(row => (
        <div key={row} className="flex min-h-20 flex-col gap-3 rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg p-3 shadow-xs shadow-shadow-shadow-3 sm:flex-row sm:items-center">
          <SkeletonRectangle className="my-0 size-10 shrink-0 animate-pulse rounded-lg" />
          <div className="min-w-0 flex-1 space-y-2">
            <SkeletonRectangle className="my-0 h-4 w-56 max-w-full animate-pulse rounded-md" />
            <SkeletonRectangle className="my-0 h-3 w-96 max-w-full animate-pulse rounded-md" />
          </div>
          <SkeletonRectangle className="my-0 h-7 w-36 animate-pulse rounded-md" />
        </div>
      ))}
    </>
  )
}

function AgentRosterEmptyState({ isSearch }: { isSearch: boolean }) {
  const { t } = useTranslation('agentV2')

  return (
    <div className="rounded-lg border border-components-panel-border bg-components-panel-on-panel-item-bg px-4 py-10 text-center shadow-xs">
      <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-state-base-hover text-text-tertiary">
        <span aria-hidden className="i-custom-vender-solid-mediaAndDevices-robot size-5" />
      </div>
      <p className="mt-3 system-sm-semibold text-text-primary">
        {isSearch ? t('roster.emptySearch') : t('roster.empty')}
      </p>
      <p className="mt-1 system-xs-regular text-text-tertiary">
        {isSearch ? t('roster.emptySearchDescription') : t('roster.emptyDescription')}
      </p>
    </div>
  )
}

function AgentRosterItem({
  agent,
}: {
  agent: AgentRosterResponse
}) {
  const { t } = useTranslation('agentV2')
  const { formatTime } = useTimestamp()
  const version = agent.active_config_snapshot?.version
  const updatedAt = agent.updated_at != null
    ? formatTime(agent.updated_at, t('roster.dateTimeFormat'))
    : null

  return (
    <article className="group flex min-h-20 min-w-0 flex-col gap-3 rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg p-3 shadow-xs shadow-shadow-shadow-3 transition-colors hover:bg-components-panel-on-panel-item-bg-hover sm:flex-row sm:items-center">
      <Link
        href={`/roster/${agent.id}/configure`}
        className="flex min-w-0 flex-1 flex-col gap-3 rounded-lg focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden sm:flex-row sm:items-center"
      >
        <div
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-lg text-text-primary-on-surface shadow-xs shadow-shadow-shadow-3',
            !agent.icon_background && 'bg-text-accent',
          )}
          style={agent.icon_background ? { backgroundColor: agent.icon_background } : undefined}
        >
          {agent.icon_type === 'emoji' && agent.icon
            ? <span aria-hidden className="text-lg leading-none">{agent.icon}</span>
            : <span aria-hidden className="i-custom-vender-solid-mediaAndDevices-robot size-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate system-md-semibold text-text-primary">
              {agent.name}
            </h2>
            {version != null && (
              <span className="shrink-0 rounded-md bg-components-badge-bg-dimm px-1.5 py-0.5 system-2xs-semibold-uppercase text-text-tertiary">
                {version}
              </span>
            )}
          </div>
          {agent.description && (
            <p className="mt-1 truncate system-sm-regular text-text-tertiary">
              {agent.description}
            </p>
          )}
        </div>
        <div className="hidden min-w-32 items-center gap-2 xl:flex">
          <span aria-hidden className="i-ri-git-branch-line size-3.5 text-text-tertiary" />
          <span className="rounded-md border-[0.5px] border-components-panel-border bg-components-badge-bg-dimm px-2 py-1 system-xs-medium text-text-secondary">
            {t(getSourceLabelKey(agent.source))}
          </span>
        </div>
        <div className="hidden w-40 shrink-0 text-right system-xs-regular text-text-tertiary lg:block">
          <span className={agent.status === 'active' ? 'text-text-success' : 'text-text-tertiary'}>
            {t(`roster.status.${agent.status}`)}
          </span>
          {updatedAt && <div className="truncate">{updatedAt}</div>}
        </div>
      </Link>
      <div className="flex w-full shrink-0 items-center justify-end gap-2 sm:w-auto sm:pl-2">
        <EditAgentDialog agent={agent} />
        <ArchiveAgentButton agentId={agent.id} agentName={agent.name} />
      </div>
    </article>
  )
}

export function AgentRosterList({
  agents,
  hasMore,
  isEmptySearch,
  isError,
  isFetching,
  isFetchingNextPage,
  isPending,
  onLoadMore,
}: AgentRosterListProps) {
  const { t } = useTranslation('agentV2')

  return (
    <div className="space-y-2" aria-busy={isFetching || undefined}>
      {isPending && <AgentRosterSkeleton />}
      {!isPending && isError && (
        <div className="rounded-lg border border-components-panel-border bg-components-panel-on-panel-item-bg px-4 py-8 text-center shadow-xs">
          <p className="system-sm-medium text-text-secondary">{t('roster.loadingError')}</p>
        </div>
      )}
      {!isPending && !isError && agents.length === 0 && (
        <AgentRosterEmptyState isSearch={isEmptySearch} />
      )}
      {!isPending && !isError && agents.map(agent => (
        <AgentRosterItem key={agent.id} agent={agent} />
      ))}
      {!isPending && !isError && hasMore && (
        <div className="flex justify-center pt-1">
          <Button
            loading={isFetchingNextPage}
            disabled={isFetchingNextPage}
            onClick={onLoadMore}
          >
            {t('roster.loadMore')}
          </Button>
        </div>
      )}
    </div>
  )
}
