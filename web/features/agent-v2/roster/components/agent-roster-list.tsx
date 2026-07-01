'use client'

import type { AgentAppPartial, AgentIconType } from '@dify/contracts/api/console/agent/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import useTimestamp from '@/hooks/use-timestamp'
import Link from '@/next/link'
import { AgentWorkflowReferencesDropdown } from './agent-workflow-references-dropdown'
import { DeleteAgentDialog } from './delete-agent-dialog'
import { DuplicateAgentDialog } from './duplicate-agent-dialog'
import { EditAgentDialog } from './edit-agent-dialog'

type AgentRosterListProps = {
  agents: AgentRosterListItem[]
  hasMore: boolean
  isEmptySearch: boolean
  isError: boolean
  isFetching: boolean
  isFetchingNextPage: boolean
  isPending: boolean
  label: string
  onLoadMore: () => void
}

export type AgentRosterListItem = AgentAppPartial

const skeletonRows = ['primary', 'secondary', 'tertiary'] as const
const emptyPlaceholderCardIds = Array.from({ length: 16 }, (_, index) => `agent-roster-placeholder-card-${index}`)

function AgentRosterSkeleton() {
  return (
    <>
      {skeletonRows.map(row => (
        <div key={row} className="relative h-36.5 rounded-xl border-[0.5px] border-components-card-border bg-components-card-bg shadow-xs shadow-shadow-shadow-3">
          <div className="flex items-center gap-3 pt-3.5 pr-4 pb-2 pl-3.5">
            <SkeletonRectangle className="my-0 size-12 shrink-0 rounded-full opacity-20" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5 py-1">
              <SkeletonRectangle className="my-0 h-3 w-36 max-w-full rounded-md opacity-20" />
              <SkeletonRectangle className="my-0 h-2 w-20 max-w-full rounded-md opacity-12" />
            </div>
          </div>
          <div className="px-4 py-1">
            <div className="flex min-h-8 flex-col gap-2 py-0.5">
              <SkeletonRectangle className="my-0 h-2 w-full rounded-md opacity-12" />
              <SkeletonRectangle className="my-0 h-2 w-3/4 rounded-md opacity-10" />
            </div>
          </div>
          <div className="flex items-center pt-2 pr-3 pb-3 pl-4">
            <SkeletonRectangle className="my-0 h-3 w-6 rounded-md opacity-12" />
            <SkeletonRectangle className="my-0 ml-2.5 h-3 w-28 rounded-md opacity-10" />
          </div>
        </div>
      ))}
    </>
  )
}

function AgentRosterPlaceholderState({ title }: { title: string }) {
  return (
    <section
      aria-labelledby="agent-roster-placeholder-title"
      className="relative col-span-full min-h-[calc(100vh-142px)] overflow-hidden"
    >
      <div className="pointer-events-none absolute inset-0 grid grid-cols-1 grid-rows-4 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {emptyPlaceholderCardIds.map(id => (
          <div key={id} className="rounded-xl bg-background-default-lighter opacity-75" />
        ))}
      </div>
      <div className="pointer-events-none absolute inset-0 bg-linear-to-b from-background-body/0 to-background-body" />
      <div className="absolute inset-0 flex items-center justify-center overflow-hidden p-2">
        <div className="flex flex-col items-center gap-3">
          <div className="flex size-14 items-center justify-center rounded-[10px]">
            <div className="flex size-full min-w-px items-center justify-center overflow-hidden rounded-xl border border-dashed border-divider-regular bg-components-card-bg p-1 backdrop-blur-md">
              <span aria-hidden className="i-ri-robot-2-line size-6 text-text-tertiary" />
            </div>
          </div>
          <h2 id="agent-roster-placeholder-title" className="system-sm-regular whitespace-nowrap text-text-tertiary">
            {title}
          </h2>
        </div>
      </div>
    </section>
  )
}

function AgentRosterItem({
  agent,
}: {
  agent: AgentRosterListItem
}) {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const { formatTime } = useTimestamp()
  const nameId = useId()
  const descriptionId = useId()
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [editSessionKey, setEditSessionKey] = useState(0)
  const [isDuplicateOpen, setIsDuplicateOpen] = useState(false)
  const [duplicateSessionKey, setDuplicateSessionKey] = useState(0)
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const updatedAt = agent.updated_at != null
    ? formatTime(agent.updated_at, t('roster.dateTimeFormat'))
    : null
  const referenceCount = agent.published_reference_count ?? 0
  const publishedReferences = agent.published_references ?? []
  const hasPublishedReferences = publishedReferences.length > 0
  const isDraft = agent.active_config_is_published !== true
  const imageUrl = (agent.icon_type === 'image' || agent.icon_type === 'link') ? agent.icon : undefined
  const iconType = (imageUrl ? 'image' : agent.icon_type) as AgentIconType | null | undefined

  const handleEditOpen = () => {
    setEditSessionKey(key => key + 1)
    setIsEditOpen(true)
  }

  const handleDuplicateOpen = () => {
    setDuplicateSessionKey(key => key + 1)
    setIsDuplicateOpen(true)
  }

  return (
    <article className="group relative col-span-1 h-36.5 min-w-0 overflow-hidden rounded-xl border-[0.5px] border-solid border-components-card-border bg-components-card-bg shadow-xs shadow-shadow-shadow-3 transition-shadow duration-200 ease-in-out hover:shadow-lg">
      <div className="flex h-full min-w-0 flex-col">
        <Link
          href={`/roster/agent/${agent.id}/configure`}
          aria-labelledby={nameId}
          aria-describedby={agent.description ? descriptionId : undefined}
          className="relative block shrink-0 cursor-pointer touch-manipulation rounded-xl outline-hidden after:pointer-events-none after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-state-accent-solid focus-visible:after:ring-inset"
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
          {isDraft && (
            <div className="absolute top-[-0.5px] right-0 flex h-5 items-start overflow-hidden">
              <div className="h-5 w-3 bg-background-section-burn [clip-path:polygon(0_0,100%_0,100%_100%)]" />
              <div className="flex h-5 items-center bg-background-section-burn pr-2 pl-0.5 system-2xs-medium-uppercase text-text-tertiary">
                {t('roster.usageStatus.draft')}
              </div>
            </div>
          )}
        </Link>
        <div className="flex min-w-0 shrink-0 items-center pt-2 pr-3 pb-3 pl-4 system-xs-regular text-text-tertiary">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            {hasPublishedReferences
              ? (
                  <AgentWorkflowReferencesDropdown
                    agentName={agent.name}
                    publishedReferences={publishedReferences}
                    referenceCount={referenceCount}
                  />
                )
              : (
                  <div className="flex h-4 shrink-0 items-center gap-1">
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
      <div
        className="pointer-events-none absolute top-2 right-2 z-20 flex items-center overflow-hidden rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 opacity-0 shadow-lg backdrop-blur-xs transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 has-data-popup-open:pointer-events-auto has-data-popup-open:opacity-100"
      >
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger
            aria-label={t('roster.moreActions', { name: agent.name })}
            className="flex size-8 cursor-pointer items-center justify-center rounded-lg p-1.5 hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden data-popup-open:bg-state-base-hover"
          >
            <span className="sr-only">{t('roster.moreActions', { name: agent.name })}</span>
            <span aria-hidden className="i-ri-more-fill size-4.5 text-text-tertiary" />
          </DropdownMenuTrigger>
          <DropdownMenuContent placement="bottom-end" sideOffset={4} popupClassName="w-40">
            <DropdownMenuItem className="gap-2" onClick={handleEditOpen}>
              <span aria-hidden className="i-ri-edit-line size-4 shrink-0 text-text-tertiary" />
              <span>{t('roster.editInfo')}</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="gap-2"
              onClick={handleDuplicateOpen}
            >
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
      <EditAgentDialog
        agent={agent}
        formKey={editSessionKey}
        open={isEditOpen}
        onOpenChange={setIsEditOpen}
      />
      <DuplicateAgentDialog
        agent={agent}
        formKey={duplicateSessionKey}
        open={isDuplicateOpen}
        onOpenChange={setIsDuplicateOpen}
      />
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
    <section aria-label={label} className="grid grid-cols-[repeat(auto-fit,minmax(296px,1fr))] gap-2.5" aria-busy={isFetching || undefined}>
      {isPending && <AgentRosterSkeleton />}
      {!isPending && isError && (
        <AgentRosterPlaceholderState title={t('roster.loadingError')} />
      )}
      {!isPending && !isError && agents.length === 0 && (
        <AgentRosterPlaceholderState title={isEmptySearch ? t('roster.emptySearch') : t('roster.empty')} />
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
