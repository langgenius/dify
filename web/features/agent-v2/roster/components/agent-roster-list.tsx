'use client'

import type { AgentPublishedReferenceResponse, AgentRosterResponse } from '@dify/contracts/api/console/agents/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import useTimestamp from '@/hooks/use-timestamp'
import Link from '@/next/link'
import { DeleteAgentDialog } from './delete-agent-dialog'
import { EditAgentDialog } from './edit-agent-dialog'

type AgentRosterListProps = {
  agents: AgentRosterResponse[]
  hasMore: boolean
  isEmptySearch: boolean
  isError: boolean
  isFetching: boolean
  isFetchingNextPage: boolean
  isPending: boolean
  label: string
  onLoadMore: () => void
}

const skeletonRows = ['primary', 'secondary', 'tertiary'] as const
const workflowReferenceAvatarClassNames = [
  'bg-components-icon-bg-green-soft text-components-icon-bg-green-solid',
  'bg-components-icon-bg-orange-dark-soft text-components-icon-bg-orange-dark-solid',
  'bg-components-icon-bg-pink-soft text-components-icon-bg-pink-solid',
  'bg-components-icon-bg-blue-soft text-components-icon-bg-blue-solid',
] as const

const getWorkflowReferenceHref = (reference: AgentPublishedReferenceResponse) => `/app/${reference.app_id}/workflow`

const getWorkflowReferenceInitial = (name: string) => {
  return name.trim().charAt(0).toUpperCase() || '?'
}

function AgentRosterSkeleton() {
  return (
    <>
      {skeletonRows.map(row => (
        <div key={row} className="relative h-36.5 rounded-xl border-[0.5px] border-components-card-border bg-components-card-bg shadow-xs shadow-shadow-shadow-3">
          <div className="flex items-center gap-3 pt-3.5 pr-4 pb-2 pl-3.5">
            <SkeletonRectangle className="my-0 size-12 shrink-0 animate-pulse rounded-full" />
            <div className="min-w-0 flex-1 space-y-2.5 py-px">
              <SkeletonRectangle className="my-0 h-4 w-36 max-w-full animate-pulse rounded-md" />
              <SkeletonRectangle className="my-0 h-3 w-20 max-w-full animate-pulse rounded-md" />
            </div>
          </div>
          <div className="px-4 py-1">
            <SkeletonRectangle className="my-0 h-3 w-full animate-pulse rounded-md" />
            <SkeletonRectangle className="mt-2 mb-0 h-3 w-3/4 animate-pulse rounded-md" />
          </div>
          <div className="flex items-center pt-2 pr-3 pb-3 pl-4">
            <SkeletonRectangle className="my-0 h-4 w-6 animate-pulse rounded-md" />
            <SkeletonRectangle className="my-0 ml-2.5 h-4 w-28 animate-pulse rounded-md" />
          </div>
        </div>
      ))}
    </>
  )
}

function AgentRosterEmptyState({ isSearch }: { isSearch: boolean }) {
  const { t } = useTranslation('agentV2')

  return (
    <div className="col-span-full rounded-xl border border-components-card-border bg-components-card-bg px-4 py-10 text-center shadow-xs">
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
  const { t: tCommon } = useTranslation('common')
  const { formatTime } = useTimestamp()
  const nameId = useId()
  const descriptionId = useId()
  const [isOperationsMenuOpen, setIsOperationsMenuOpen] = useState(false)
  const [isReferencesMenuOpen, setIsReferencesMenuOpen] = useState(false)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const updatedAt = agent.updated_at != null
    ? formatTime(agent.updated_at, t('roster.dateTimeFormat'))
    : null
  const referenceCount = agent.published_reference_count ?? 0
  const publishedReferences = agent.published_references ?? []
  const hasPublishedReferences = publishedReferences.length > 0
  const usageStatus = referenceCount > 0 ? 'inUse' : 'draft'
  const imageUrl = (agent.icon_type === 'image' || agent.icon_type === 'link') ? agent.icon : undefined
  const iconType = imageUrl ? 'image' : agent.icon_type

  return (
    <article className="group relative col-span-1 h-36.5 min-w-0 overflow-hidden rounded-xl border-[0.5px] border-solid border-components-card-border bg-components-card-bg shadow-xs shadow-shadow-shadow-3 transition-shadow duration-200 ease-in-out hover:shadow-lg">
      <div className="flex h-full min-w-0 flex-col">
        <Link
          href={`/roster/agent/${agent.id}/configure`}
          aria-labelledby={nameId}
          aria-describedby={agent.description ? descriptionId : undefined}
          className="block shrink-0 cursor-pointer touch-manipulation rounded-xl outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:ring-inset"
        >
          <div className="flex items-center gap-3 pt-3.5 pr-4 pb-2 pl-3.5">
            <span aria-hidden className="shrink-0">
              <AppIcon
                size="xl"
                rounded
                iconType={iconType}
                icon={agent.icon ?? undefined}
                background={agent.icon_background}
                imageUrl={imageUrl}
              />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-px">
              <h2 id={nameId} className="truncate system-md-semibold text-text-secondary">
                {agent.name}
              </h2>
              <p className="truncate system-xs-regular text-text-tertiary">
                {agent.role}
              </p>
            </div>
          </div>
          <div className="px-4 py-1 system-xs-regular text-text-tertiary">
            <div id={descriptionId} className="line-clamp-2 min-h-8">
              {agent.description}
            </div>
          </div>
        </Link>
        <div className="flex min-w-0 shrink-0 items-center pt-2 pr-3 pb-3 pl-4 system-xs-regular text-text-tertiary">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            {hasPublishedReferences
              ? (
                  <DropdownMenu modal={false} open={isReferencesMenuOpen} onOpenChange={setIsReferencesMenuOpen}>
                    <DropdownMenuTrigger
                      aria-label={t('roster.references.trigger', { name: agent.name, count: referenceCount })}
                      className={cn(
                        '-ml-1 flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-1 py-0.5 outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid',
                        isReferencesMenuOpen ? 'bg-state-base-hover' : 'hover:bg-state-base-hover',
                      )}
                    >
                      <span aria-hidden className="i-custom-vender-agent-v2-plan size-3 shrink-0 text-text-tertiary" />
                      <span className="system-xs-regular text-text-tertiary">{referenceCount}</span>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent placement="bottom-start" sideOffset={4} popupClassName="w-[264px] p-1">
                      <div className="px-2 pt-1 pb-1.5 system-xs-medium text-text-tertiary">
                        {t('roster.references.label', { name: agent.name })}
                      </div>
                      {publishedReferences.map((reference, index) => (
                        <DropdownMenuLinkItem
                          key={`${reference.app_id}-${reference.workflow_id}`}
                          render={<Link href={getWorkflowReferenceHref(reference)} />}
                          className="mx-0 h-8 gap-2 px-2 py-1 pr-2.5 system-md-regular text-text-secondary"
                        >
                          <span
                            aria-hidden
                            className={cn(
                              'flex size-6 shrink-0 items-center justify-center rounded-md border-[0.5px] border-divider-regular system-xs-medium',
                              workflowReferenceAvatarClassNames[index % workflowReferenceAvatarClassNames.length],
                            )}
                          >
                            {getWorkflowReferenceInitial(reference.app_name)}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{reference.app_name}</span>
                          <span aria-hidden className="i-ri-external-link-line size-3 shrink-0 text-text-tertiary" />
                        </DropdownMenuLinkItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )
              : (
                  <div className="flex shrink-0 items-center gap-1">
                    <span aria-hidden className="i-custom-vender-agent-v2-plan size-3 shrink-0 text-text-tertiary" />
                    <span className="system-xs-regular text-text-tertiary">{referenceCount}</span>
                  </div>
                )}
            {updatedAt && (
              <>
                <span aria-hidden className="shrink-0 text-text-quaternary">·</span>
                <span className="min-w-0 truncate">{updatedAt}</span>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="absolute top-0 right-0 flex h-5 items-start overflow-hidden">
        <div className="h-5 w-3 bg-background-section-burn [clip-path:polygon(0_0,100%_0,100%_100%)]" />
        <div className="flex h-5 items-center bg-background-section-burn pr-2 pl-0.5 system-2xs-medium-uppercase text-text-tertiary">
          {t(`roster.usageStatus.${usageStatus}`)}
        </div>
      </div>
      <div
        className={cn(
          'absolute top-2 right-2 z-20 flex items-center overflow-hidden rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 shadow-lg backdrop-blur-xs transition-opacity',
          isOperationsMenuOpen
            ? 'pointer-events-auto opacity-100'
            : 'pointer-events-none opacity-0 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100',
        )}
      >
        <DropdownMenu modal={false} open={isOperationsMenuOpen} onOpenChange={setIsOperationsMenuOpen}>
          <DropdownMenuTrigger
            aria-label={t('roster.moreActions', { name: agent.name })}
            className={cn(
              'flex size-8 cursor-pointer items-center justify-center rounded-lg p-1.5 focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
              isOperationsMenuOpen ? 'bg-state-base-hover' : 'hover:bg-state-base-hover',
            )}
          >
            <span className="sr-only">{t('roster.moreActions', { name: agent.name })}</span>
            <span aria-hidden className="i-ri-more-fill size-4.5 text-text-tertiary" />
          </DropdownMenuTrigger>
          <DropdownMenuContent placement="bottom-end" sideOffset={4} popupClassName="w-40">
            <DropdownMenuItem className="gap-2" onClick={() => setIsEditOpen(true)}>
              <span aria-hidden className="i-ri-edit-line size-4 shrink-0 text-text-tertiary" />
              <span>{t('roster.editInfo')}</span>
            </DropdownMenuItem>
            <DropdownMenuItem disabled className="gap-2">
              <span aria-hidden className="i-ri-file-copy-line size-4 shrink-0 text-text-tertiary" />
              <span>{tCommon('operation.duplicate')}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              className="gap-2"
              onClick={() => setIsDeleteOpen(true)}
            >
              <span aria-hidden className="i-ri-delete-bin-line size-4 shrink-0" />
              <span>{tCommon('operation.delete')}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <EditAgentDialog agent={agent} open={isEditOpen} onOpenChange={setIsEditOpen} />
      <DeleteAgentDialog agentId={agent.id} agentName={agent.name} open={isDeleteOpen} onOpenChange={setIsDeleteOpen} />
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
  label,
  onLoadMore,
}: AgentRosterListProps) {
  const { t } = useTranslation('agentV2')

  return (
    <section aria-label={label} className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,294px),1fr))] gap-2.5" aria-busy={isFetching || undefined}>
      {isPending && <AgentRosterSkeleton />}
      {!isPending && isError && (
        <div className="col-span-full rounded-xl border border-components-card-border bg-components-card-bg px-4 py-8 text-center shadow-xs">
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
        <div className="col-span-full flex justify-center pt-1">
          <Button
            loading={isFetchingNextPage}
            disabled={isFetchingNextPage}
            onClick={onLoadMore}
          >
            {t('roster.loadMore')}
          </Button>
        </div>
      )}
    </section>
  )
}
