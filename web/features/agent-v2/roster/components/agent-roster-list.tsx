'use client'

import type { AgentAppPartial } from '@dify/contracts/api/console/agent/types.gen'
import { zAgentIconType } from '@dify/contracts/api/console/agent/zod.gen'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { toast } from '@langgenius/dify-ui/toast'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useExportAppDsl } from '@/app/components/app/use-export-app-dsl'
import AppIcon from '@/app/components/base/app-icon'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import { MAIN_NAV_APP_CARD_GRID_CLASS_NAME } from '@/app/components/main-nav/app-card-grid'
import useTimestamp from '@/hooks/use-timestamp'
import Link from '@/next/link'
import { AgentWorkflowReferencesDropdown } from './agent-workflow-references-dropdown'
import { DeleteAgentDialog } from './delete-agent-dialog'
import { DuplicateAgentDialog } from './duplicate-agent-dialog'
import { EditAgentDialog } from './edit-agent-dialog'

type AgentRosterListFooterState =
  | { status: 'none' }
  | { status: 'load-more'; isLoading: boolean; onLoadMore: () => void }
  | { status: 'error'; onRetry: () => void }

export type AgentRosterListState =
  | { status: 'pending' }
  | { status: 'error'; onRetry: () => void }
  | {
      status: 'ready'
      agents: AgentAppPartial[]
      emptyState: 'roster' | 'filtered'
      footer: AgentRosterListFooterState
      isFetching: boolean
    }

type AgentRosterListProps = {
  label: string
  state: AgentRosterListState
}

const skeletonCardIds = Array.from(
  { length: 6 },
  (_, index) => `agent-roster-skeleton-card-${index}`,
)
const AGENT_ROSTER_GRID_CLASS_NAME = cn('gap-2.5', MAIN_NAV_APP_CARD_GRID_CLASS_NAME)
const emptyPlaceholderCardIds = Array.from(
  { length: 16 },
  (_, index) => `agent-roster-placeholder-card-${index}`,
)

function AgentRosterSkeleton() {
  const { t } = useTranslation('common')

  return (
    <>
      <span role="status" className="sr-only col-span-full">
        {t(($) => $.loading)}
      </span>
      {skeletonCardIds.map((id) => (
        <div
          key={id}
          className="relative h-36.5 rounded-xl border-[0.5px] border-components-card-border bg-components-card-bg shadow-xs shadow-shadow-shadow-3"
        >
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

function AgentRosterPlaceholderState({
  onRetry,
  role,
  title,
}: {
  onRetry?: () => void
  role?: 'alert' | 'status'
  title: string
}) {
  const { t } = useTranslation('common')

  return (
    <section
      aria-labelledby="agent-roster-placeholder-title"
      className="relative col-span-full min-h-[calc(100vh-142px)] overflow-hidden"
      role={role}
    >
      <div
        className={cn(
          'pointer-events-none absolute inset-0 grid-rows-4',
          AGENT_ROSTER_GRID_CLASS_NAME,
        )}
      >
        {emptyPlaceholderCardIds.map((id) => (
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
          <h2
            id="agent-roster-placeholder-title"
            className="system-sm-regular whitespace-nowrap text-text-tertiary"
          >
            {title}
          </h2>
          {onRetry && (
            <Button size="small" variant="secondary" onClick={onRetry}>
              {t(($) => $['operation.retry'])}
            </Button>
          )}
        </div>
      </div>
    </section>
  )
}

function AgentRosterItem({ agent }: { agent: AgentAppPartial }) {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const { t: tApp } = useTranslation('app')
  const { formatTime } = useTimestamp()
  const nameId = useId()
  const descriptionId = useId()
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [editSessionKey, setEditSessionKey] = useState(0)
  const [isDuplicateOpen, setIsDuplicateOpen] = useState(false)
  const [duplicateSessionKey, setDuplicateSessionKey] = useState(0)
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const { exportAppDsl, isExporting } = useExportAppDsl()
  const updatedAt =
    agent.updated_at != null
      ? formatTime(
          agent.updated_at,
          t(($) => $['roster.dateTimeFormat']),
        )
      : null
  const referenceCount = agent.published_reference_count ?? 0
  const publishedReferences = agent.published_references ?? []
  const hasPublishedReferences = publishedReferences.length > 0
  const isDraft = agent.active_config_is_published !== true
  const parsedIconType = zAgentIconType.safeParse(agent.icon_type).data
  const imageUrl = parsedIconType === 'image' || parsedIconType === 'link' ? agent.icon : undefined
  const iconType = parsedIconType === 'link' ? 'image' : parsedIconType

  const handleEditOpen = () => {
    setEditSessionKey((key) => key + 1)
    setIsEditOpen(true)
  }

  const handleDuplicateOpen = () => {
    setDuplicateSessionKey((key) => key + 1)
    setIsDuplicateOpen(true)
  }

  const handleExport = () => {
    if (!agent.app_id) {
      toast.error(tApp(($) => $.exportFailed))
      return
    }

    return exportAppDsl({
      appId: agent.app_id,
      appName: agent.name,
    })
  }

  return (
    <article
      aria-labelledby={nameId}
      className="group relative isolate col-span-1 flex h-36.5 min-w-0 flex-col overflow-hidden rounded-xl border-[0.5px] border-solid border-components-card-border bg-components-card-bg shadow-xs shadow-shadow-shadow-3 transition-shadow duration-200 ease-in-out after:pointer-events-none after:absolute after:inset-0 after:z-3 after:rounded-xl after:content-[''] focus-within:bg-components-card-bg-alt hover:bg-components-card-bg-alt hover:shadow-md hover:shadow-shadow-shadow-5 has-data-popup-open:bg-components-card-bg-alt has-[>a:focus-visible]:after:inset-ring-2 has-[>a:focus-visible]:after:inset-ring-state-accent-solid [@media(hover:none)]:bg-components-card-bg-alt"
    >
      <Link
        href={`/agents/${agent.id}/configure`}
        aria-labelledby={nameId}
        aria-describedby={agent.description ? descriptionId : undefined}
        className="absolute inset-0 z-1 cursor-pointer touch-manipulation rounded-xl outline-hidden"
      />
      <div className="pointer-events-none absolute top-[-0.5px] right-[-0.5px] z-2 flex h-16 w-30 items-start justify-end bg-[linear-gradient(67deg,var(--color-components-card-bg-alt-transparent)_0%,var(--color-components-card-bg-alt)_75%)] p-2 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 has-data-popup-open:opacity-100 [@media(hover:none)]:opacity-100">
        <div className="pointer-events-none flex items-center overflow-hidden rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 shadow-lg backdrop-blur-xs group-focus-within:pointer-events-auto group-hover:pointer-events-auto has-data-popup-open:pointer-events-auto [@media(hover:none)]:pointer-events-auto">
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger
              render={
                <IconButton
                  aria-label={t(($) => $['roster.moreActions'], { name: agent.name })}
                  size="lg"
                  className="data-popup-open:bg-state-base-hover"
                >
                  <span aria-hidden className="i-ri-more-fill size-4.5" />
                </IconButton>
              }
            />
            <DropdownMenuContent placement="bottom-end" sideOffset={4} className="w-40">
              <DropdownMenuItem className="gap-2" onClick={handleEditOpen}>
                <span aria-hidden className="i-ri-edit-line size-4 shrink-0 text-text-tertiary" />
                <span>{t(($) => $['roster.editInfo'])}</span>
              </DropdownMenuItem>
              <DropdownMenuItem className="gap-2" onClick={handleDuplicateOpen}>
                <span
                  aria-hidden
                  className="i-ri-file-copy-line size-4 shrink-0 text-text-tertiary"
                />
                <span>{tCommon(($) => $['operation.duplicate'])}</span>
              </DropdownMenuItem>
              <DropdownMenuItem className="gap-2" disabled={isExporting} onClick={handleExport}>
                <span
                  aria-hidden
                  className="i-ri-download-line size-4 shrink-0 text-text-tertiary"
                />
                <span>{tApp(($) => $.export)}</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                className="gap-2"
                onClick={() => setIsDeleteOpen(true)}
              >
                <span aria-hidden className="i-ri-delete-bin-line size-4 shrink-0" />
                <span>{tCommon(($) => $['operation.delete'])}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
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
          <p className="truncate system-xs-regular text-text-tertiary">{agent.role}</p>
        </div>
      </div>
      <div className="px-4 py-1 system-xs-regular text-text-tertiary">
        <div id={descriptionId} className="line-clamp-2 min-h-8">
          {agent.description}
        </div>
      </div>
      <div className="flex min-w-0 shrink-0 items-center pt-2 pr-3 pb-3 pl-4 system-xs-regular text-text-tertiary">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {hasPublishedReferences ? (
            <AgentWorkflowReferencesDropdown
              agentName={agent.name}
              publishedReferences={publishedReferences}
              referenceCount={referenceCount}
            />
          ) : (
            <div className="flex h-4 shrink-0 items-center gap-1">
              <span
                aria-hidden
                className="i-custom-vender-agent-v2-plan size-3 shrink-0 text-text-tertiary"
              />
              <span className="sr-only">
                {t(($) => $['roster.references.trigger'], { name: agent.name })}:{' '}
              </span>
              <span className="system-xs-regular text-text-tertiary">{referenceCount}</span>
            </div>
          )}
          {updatedAt && (
            <>
              <span aria-hidden className="shrink-0 text-text-quaternary">
                ·
              </span>
              <span className="min-w-0 truncate">{updatedAt}</span>
            </>
          )}
        </div>
      </div>
      {isDraft && (
        <div className="absolute top-[-0.5px] right-0 flex h-5 items-start overflow-hidden">
          <div className="h-5 w-3 bg-background-section-burn [clip-path:polygon(0_0,100%_0,100%_100%)]" />
          <div className="flex h-5 items-center bg-background-section-burn pr-2 pl-0.5 system-2xs-medium-uppercase text-text-tertiary">
            {t(($) => $['roster.usageStatus.draft'])}
          </div>
        </div>
      )}
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
      <DeleteAgentDialog
        agentId={agent.id}
        agentName={agent.name}
        open={isDeleteOpen}
        onOpenChange={setIsDeleteOpen}
      />
    </article>
  )
}

export function AgentRosterList({ label, state }: AgentRosterListProps) {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const isBusy = state.status === 'pending' || (state.status === 'ready' && state.isFetching)

  return (
    <section aria-label={label} className={AGENT_ROSTER_GRID_CLASS_NAME} aria-busy={isBusy}>
      {state.status === 'pending' && <AgentRosterSkeleton />}
      {state.status === 'error' && (
        <AgentRosterPlaceholderState
          onRetry={state.onRetry}
          role="alert"
          title={t(($) => $['roster.loadingError'])}
        />
      )}
      {state.status === 'ready' && state.agents.length === 0 && (
        <AgentRosterPlaceholderState
          role={state.emptyState === 'filtered' ? 'status' : undefined}
          title={
            state.emptyState === 'filtered'
              ? t(($) => $['roster.emptySearch'])
              : t(($) => $['roster.empty'])
          }
        />
      )}
      {state.status === 'ready' &&
        state.agents.map((agent) => <AgentRosterItem key={agent.id} agent={agent} />)}
      {state.status === 'ready' && state.footer.status === 'error' && (
        <div
          className="col-span-full flex items-center justify-center gap-3 pt-1 system-xs-regular text-text-destructive"
          role="alert"
        >
          <span>{t(($) => $['roster.loadingError'])}</span>
          <Button size="small" variant="secondary" onClick={state.footer.onRetry}>
            {tCommon(($) => $['operation.retry'])}
          </Button>
        </div>
      )}
      {state.status === 'ready' && state.footer.status === 'load-more' && (
        <div className="col-span-full flex justify-center pt-1">
          <Button loading={state.footer.isLoading} onClick={state.footer.onLoadMore}>
            {t(($) => $['roster.loadMore'])}
          </Button>
        </div>
      )}
    </section>
  )
}
