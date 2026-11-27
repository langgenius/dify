'use client'

import type { AgentAppPartial } from '@dify/contracts/api/console/agent/types.gen'
import type { DialogHandle } from '@langgenius/dify-ui/dialog'
import type { ComponentProps, RefObject } from 'react'
import {
  AlertDialog,
  AlertDialogContent,
  createAlertDialogHandle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@langgenius/dify-ui/context-menu'
import { createDialogHandle, Dialog } from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@langgenius/dify-ui/menu'
import { useMutation } from '@tanstack/react-query'
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useExportAppDsl } from '@/app/components/app/use-export-app-dsl'
import AppIcon from '@/app/components/base/app-icon'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import { MAIN_NAV_APP_CARD_GRID_CLASS_NAME } from '@/app/components/main-nav/app-card-grid'
import { toast } from '@/app/notifications'
import { getAgentACLCapabilities, getAgentDefaultSection } from '@/features/agent-v2/acl'
import { DeleteAgentForm } from '@/features/agent-v2/delete-agent-form'
import { useCanCreateAgents } from '@/features/agent-v2/permissions'
import { TagSelector } from '@/features/tag-management/tag-selector'
import useTimestamp from '@/hooks/use-timestamp'
import Link from '@/next/link'
import { consoleQuery } from '@/service/console'
import { useRequestErrorDescriber } from '@/service/use-request-error-message'
import { getAdjacentFocusTargets } from '@/utils/get-adjacent-focus-targets'
import { AgentWorkflowReferencesMenu } from './agent-workflow-references-menu'
import { DuplicateAgentDialogContent } from './duplicate-agent-dialog'
import { EditAgentDialogContent } from './edit-agent-dialog'
import { ReadOnlyAgentTags } from './read-only-agent-tags'

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
      emptyState: 'roster' | { type: 'filtered'; onClearFilters: () => void }
      footer: AgentRosterListFooterState
      isFetching: boolean
    }

type AgentRosterListProps = {
  state: AgentRosterListState
  onOpenTagManagement: () => void
} & Pick<ComponentProps<'div'>, 'aria-labelledby'>

type DeleteAgentDialogPayload = Pick<AgentAppPartial, 'id' | 'name'> & {
  fallbackFocus: RefObject<HTMLElement | null>
  adjacentFocusTargets: HTMLElement[]
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
  const { t } = useTranslation(['common'])

  return (
    <>
      <span role="status" className="sr-only col-span-full">
        {t(($) => $.loading)}
      </span>
      {skeletonCardIds.map((id) => (
        <div
          key={id}
          className="relative h-43 rounded-xl border-[0.5px] border-components-card-border bg-components-card-bg shadow-xs shadow-shadow-shadow-3"
        >
          <div className="flex items-center gap-3 ps-3.5 pe-4 pt-3.5 pb-2">
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
          <div className="flex h-6.5 items-center gap-1 px-4">
            <SkeletonRectangle className="my-0 h-4 w-14 rounded-md opacity-12" />
            <SkeletonRectangle className="my-0 h-4 w-20 rounded-md opacity-12" />
          </div>
          <div className="flex items-center ps-4 pe-3 pt-2 pb-3">
            <SkeletonRectangle className="my-0 h-3 w-6 rounded-md opacity-12" />
            <SkeletonRectangle className="my-0 ms-2.5 h-3 w-28 rounded-md opacity-10" />
          </div>
        </div>
      ))}
    </>
  )
}

function AgentRosterPlaceholderState({
  action,
  description,
  role,
  title,
}: {
  action?: { label: string; onClick: () => void }
  description?: string
  role?: 'alert' | 'status'
  title: string
}) {
  return (
    <div className="relative min-h-[calc(100vh-142px)] overflow-hidden">
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
        <div className="flex max-w-full flex-col items-center gap-3 text-center system-sm-regular text-text-tertiary">
          <div
            role={role}
            aria-labelledby="agent-roster-placeholder-title"
            className="flex flex-col items-center gap-3"
          >
            <span
              aria-hidden
              className="flex size-14 items-center justify-center rounded-xl border border-dashed border-divider-regular bg-components-card-bg p-1 backdrop-blur-md"
            >
              <span className="i-ri-robot-line size-6" />
            </span>
            <h2 id="agent-roster-placeholder-title">{title}</h2>
            {description && <p>{description}</p>}
          </div>
          {action && (
            <Button size="small" variant="secondary" onClick={action.onClick}>
              {action.label}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

type AgentCardActionMenuItemsProps = {
  kind: 'context' | 'menu'
  isExporting: boolean
  onDelete?: () => void
  onDuplicate?: () => void
  onEdit?: () => void
  onExport?: () => void
}

function AgentCardActionMenuItems({
  kind,
  isExporting,
  onDelete,
  onDuplicate,
  onEdit,
  onExport,
}: AgentCardActionMenuItemsProps) {
  const { t } = useTranslation(['agentRoster'])
  const { t: tCommon } = useTranslation(['common'])
  const { t: tAgent } = useTranslation(['agentV2'])
  const ActionItem = kind === 'context' ? ContextMenuItem : MenuItem
  const ActionSeparator = kind === 'context' ? ContextMenuSeparator : MenuSeparator

  return (
    <>
      {onEdit && (
        <ActionItem className="gap-2" onClick={onEdit}>
          <span aria-hidden className="i-ri-edit-line size-4 shrink-0 text-text-tertiary" />
          <span>{t(($) => $['roster.editInfo'], { ns: 'agentRoster' })}</span>
        </ActionItem>
      )}
      {onDuplicate && (
        <ActionItem className="gap-2" onClick={onDuplicate}>
          <span aria-hidden className="i-ri-file-copy-line size-4 shrink-0 text-text-tertiary" />
          <span>{tCommon(($) => $['operation.duplicate'])}</span>
        </ActionItem>
      )}
      {onExport && (
        <ActionItem className="gap-2" disabled={isExporting} onClick={onExport}>
          <span aria-hidden className="i-ri-download-line size-4 shrink-0 text-text-tertiary" />
          <span>{tAgent(($) => $.exportAgent)}</span>
        </ActionItem>
      )}
      {onDelete && (onEdit || onDuplicate || onExport) && <ActionSeparator />}
      {onDelete && (
        <ActionItem variant="destructive" className="gap-2" onClick={onDelete}>
          <span aria-hidden className="i-ri-delete-bin-line size-4 shrink-0" />
          <span>{tCommon(($) => $['operation.delete'])}</span>
        </ActionItem>
      )}
    </>
  )
}

function AgentRosterItem({
  agent,
  duplicateDialog,
  editDialog,
  onDelete,
  onOpenTagManagement,
}: {
  agent: AgentAppPartial
  duplicateDialog: DialogHandle<AgentAppPartial>
  editDialog: DialogHandle<AgentAppPartial>
  onDelete: (item: HTMLLIElement | null) => void
  onOpenTagManagement: () => void
}) {
  const { t } = useTranslation(['agentRoster'])
  const { t: tApp } = useTranslation(['app'])
  const { formatTime } = useTimestamp()
  const itemRef = useRef<HTMLLIElement>(null)
  const nameId = useId()
  const descriptionId = useId()
  const draftStatusId = useId()
  const { exportAppDsl, isExporting } = useExportAppDsl()
  const capabilities = getAgentACLCapabilities(agent.permission_keys)
  const isPreviewOnly = agent.permission_keys?.length === 1 && capabilities.canPreview
  const canDuplicate = useCanCreateAgents() && capabilities.canPreview
  const hasActions =
    capabilities.canEdit ||
    canDuplicate ||
    capabilities.canImportExportDSL ||
    capabilities.canDelete
  const defaultSection = getAgentDefaultSection(capabilities)
  const updatedAt =
    agent.updated_at != null
      ? formatTime(
          agent.updated_at,
          t(($) => $['roster.dateTimeFormat'], { ns: 'agentRoster' }),
        )
      : null
  const referenceCount = agent.published_reference_count ?? 0
  const publishedReferences = agent.published_references ?? []
  const hasPublishedReferences = publishedReferences.length > 0
  const isDraft = agent.active_config_is_published !== true
  const accessibleDescriptionIds = [
    isDraft ? draftStatusId : '',
    agent.description ? descriptionId : '',
  ]
    .filter(Boolean)
    .join(' ')

  const handleExport = () => {
    if (!agent.app_id) {
      toast.error(tApp(($) => $.exportFailed))
      return
    }

    return exportAppDsl({
      format: 'ifpkg',
      appId: agent.app_id,
      appName: agent.name,
    })
  }

  const showPreviewOnlyAccessWarning = () => {
    toast.warning(tApp(($) => $.noAccessResourcePermission))
  }

  const cardContent = (
    <>
      <div className="flex items-center gap-3 ps-3.5 pe-4 pt-3.5 pb-2">
        <span aria-hidden className="shrink-0">
          <AppIcon size="xl" shape="circle" icon={agent} />
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
      {isDraft && (
        <div className="pointer-events-none absolute inset-e-0 top-[-0.5px] flex h-5 items-start overflow-hidden">
          <div className="h-5 w-3 bg-background-section-burn [clip-path:polygon(0_0,100%_0,100%_100%)] rtl:-scale-x-100" />
          <div
            id={draftStatusId}
            className="flex h-5 items-center bg-background-section-burn ps-0.5 pe-2 system-2xs-medium-uppercase text-text-tertiary"
          >
            {t(($) => $['roster.usageStatus.draft'], { ns: 'agentRoster' })}
          </div>
        </div>
      )}
    </>
  )
  const cardClassName = 'flex h-full min-w-0 flex-col rounded-xl pb-9 outline-hidden'

  return (
    <li
      ref={itemRef}
      aria-labelledby={nameId}
      aria-describedby={defaultSection ? undefined : accessibleDescriptionIds || undefined}
      className={cn(
        "group relative isolate col-span-1 h-43 min-w-0 overflow-hidden rounded-xl border-[0.5px] border-solid border-components-card-border bg-components-card-bg shadow-xs shadow-shadow-shadow-3 transition-shadow duration-200 ease-in-out after:pointer-events-none after:absolute after:inset-0 after:z-1 after:rounded-xl after:content-[''] focus-within:bg-components-card-bg-alt has-[>a:focus-visible]:after:inset-ring-2 has-[>a:focus-visible]:after:inset-ring-state-accent-solid has-[>button:focus-visible]:after:inset-ring-2 has-[>button:focus-visible]:after:inset-ring-state-accent-solid motion-reduce:transition-none",
        isPreviewOnly
          ? 'opacity-60'
          : 'hover:bg-components-card-bg-alt hover:shadow-md hover:shadow-shadow-shadow-5 has-data-popup-open:bg-components-card-bg-alt has-data-popup-open:shadow-md has-data-popup-open:shadow-shadow-shadow-5 [@media(hover:none)]:bg-components-card-bg-alt',
      )}
    >
      <ContextMenu>
        <ContextMenuTrigger
          render={
            defaultSection ? (
              <Link
                href={`/agents/${agent.id}/${defaultSection}`}
                aria-labelledby={nameId}
                aria-describedby={accessibleDescriptionIds || undefined}
                className={cn(cardClassName, 'cursor-pointer touch-manipulation')}
              >
                {cardContent}
              </Link>
            ) : isPreviewOnly ? (
              <button
                type="button"
                aria-labelledby={nameId}
                aria-describedby={accessibleDescriptionIds || undefined}
                className={cn(cardClassName, 'w-full cursor-not-allowed text-start')}
                onClick={showPreviewOnlyAccessWarning}
              >
                {cardContent}
              </button>
            ) : (
              <div className={cardClassName}>{cardContent}</div>
            )
          }
        />
        {hasActions && (
          <ContextMenuContent className="w-max min-w-40">
            <AgentCardActionMenuItems
              kind="context"
              isExporting={isExporting}
              onEdit={capabilities.canEdit ? () => editDialog.openWithPayload(agent) : undefined}
              onDuplicate={canDuplicate ? () => duplicateDialog.openWithPayload(agent) : undefined}
              onExport={capabilities.canImportExportDSL ? handleExport : undefined}
              onDelete={capabilities.canDelete ? () => onDelete(itemRef.current) : undefined}
            />
          </ContextMenuContent>
        )}
      </ContextMenu>
      {hasActions && (
        <div className="pointer-events-none absolute inset-e-[-0.5px] top-[-0.5px] flex h-16 w-30 items-start justify-end bg-[linear-gradient(67deg,var(--color-components-card-bg-alt-transparent)_0%,var(--color-components-card-bg-alt)_75%)] p-2 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 has-data-popup-open:opacity-100 rtl:bg-[linear-gradient(293deg,var(--color-components-card-bg-alt-transparent)_0%,var(--color-components-card-bg-alt)_75%)] [@media(hover:none)]:opacity-100">
          <div className="pointer-events-none flex items-center overflow-hidden rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 shadow-lg backdrop-blur-xs group-focus-within:pointer-events-auto group-hover:pointer-events-auto has-data-popup-open:pointer-events-auto [@media(hover:none)]:pointer-events-auto">
            <Menu modal={false}>
              <MenuTrigger
                render={
                  <IconButton
                    aria-label={t(($) => $['roster.moreActions'], {
                      ns: 'agentRoster',
                      name: agent.name,
                    })}
                    size="lg"
                    className="data-popup-open:bg-state-base-hover"
                  >
                    <span aria-hidden className="i-ri-more-fill size-4.5" />
                  </IconButton>
                }
              />
              <MenuContent align="end" className="w-max min-w-40">
                <AgentCardActionMenuItems
                  kind="menu"
                  isExporting={isExporting}
                  onEdit={
                    capabilities.canEdit ? () => editDialog.openWithPayload(agent) : undefined
                  }
                  onDuplicate={
                    canDuplicate ? () => duplicateDialog.openWithPayload(agent) : undefined
                  }
                  onExport={capabilities.canImportExportDSL ? handleExport : undefined}
                  onDelete={capabilities.canDelete ? () => onDelete(itemRef.current) : undefined}
                />
              </MenuContent>
            </Menu>
          </div>
        </div>
      )}
      <div
        className={cn(
          'absolute inset-x-3 bottom-9',
          !capabilities.canEdit && 'pointer-events-none',
        )}
      >
        {capabilities.canEdit ? (
          <TagSelector
            type="agent"
            targetId={agent.id}
            contextLabel={agent.name}
            value={agent.tags ?? []}
            canBindOrUnbindTags
            onOpenTagManagement={onOpenTagManagement}
          />
        ) : (
          <ReadOnlyAgentTags agent={agent} />
        )}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex min-w-0 items-center ps-4 pe-3 pt-2 pb-3 system-xs-regular text-text-tertiary">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {hasPublishedReferences ? (
            <AgentWorkflowReferencesMenu
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
                {t(($) => $['roster.references.trigger'], { ns: 'agentRoster', name: agent.name })}
                :{' '}
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
    </li>
  )
}

export function AgentRosterList({
  state,
  onOpenTagManagement,
  'aria-labelledby': ariaLabelledBy,
}: AgentRosterListProps) {
  const { t } = useTranslation(['agentRoster'])
  const { t: tCommon } = useTranslation(['common'])
  const describeRequestError = useRequestErrorDescriber()
  const isBusy = state.status === 'pending' || (state.status === 'ready' && state.isFetching)
  const [deleteDialog] = useState(() => createAlertDialogHandle<DeleteAgentDialogPayload>())
  const [editDialog] = useState(() => createDialogHandle<AgentAppPartial>())
  const [duplicateDialog] = useState(() => createDialogHandle<AgentAppPartial>())
  const agentUpdate = useMutation(consoleQuery.agent.byAgentId.put.mutationOptions())
  const agentCopy = useMutation(consoleQuery.agent.byAgentId.copy.post.mutationOptions())
  const regionRef = useRef<HTMLDivElement>(null)
  const deletion = useMutation(
    consoleQuery.agent.byAgentId.delete.mutationOptions({
      meta: { errorToast: false },
    }),
  )

  return (
    <>
      <div
        ref={regionRef}
        role="region"
        aria-labelledby={ariaLabelledBy}
        aria-busy={isBusy}
        tabIndex={-1}
        className="min-w-0 px-2 pt-2 pb-8 outline-hidden sm:px-8"
      >
        {state.status === 'pending' && (
          <div className={AGENT_ROSTER_GRID_CLASS_NAME}>
            <AgentRosterSkeleton />
          </div>
        )}
        {state.status === 'error' && (
          <AgentRosterPlaceholderState
            action={{ label: tCommon(($) => $['operation.retry']), onClick: state.onRetry }}
            role="alert"
            title={t(($) => $['roster.loadingError'], { ns: 'agentRoster' })}
          />
        )}
        {state.status === 'ready' &&
          state.agents.length === 0 &&
          (state.emptyState === 'roster' ? (
            <AgentRosterPlaceholderState title={t(($) => $['roster.empty'])} />
          ) : (
            <AgentRosterPlaceholderState
              role="status"
              title={t(($) => $['roster.emptySearch'])}
              description={t(($) => $['roster.emptySearchDescription'])}
              action={{
                label: t(($) => $['roster.clearFilters']),
                onClick: state.emptyState.onClearFilters,
              }}
            />
          ))}
        {state.status === 'ready' && state.agents.length > 0 && (
          <ul
            // Safari list semantics: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/list-style#accessibility
            // oxlint-disable-next-line jsx-a11y/no-redundant-roles -- Dify's preflight removes list markers.
            role="list"
            aria-label={t(($) => $['roster.listLabel'])}
            className={AGENT_ROSTER_GRID_CLASS_NAME}
          >
            {state.agents.map((agent) => (
              <AgentRosterItem
                key={agent.id}
                agent={agent}
                duplicateDialog={duplicateDialog}
                editDialog={editDialog}
                onOpenTagManagement={onOpenTagManagement}
                onDelete={(item) => {
                  deleteDialog.openWithPayload({
                    id: agent.id,
                    name: agent.name,
                    adjacentFocusTargets: getAdjacentFocusTargets(item, (sibling) =>
                      sibling.querySelector<HTMLElement>(':scope > a[href], :scope > button'),
                    ),
                    fallbackFocus: { current: null },
                  })
                }}
              />
            ))}
          </ul>
        )}
        {state.status === 'ready' && state.footer.status === 'error' && (
          <div
            className="flex items-center justify-center gap-3 pt-1 system-xs-regular text-text-destructive"
            role="alert"
          >
            <span>{t(($) => $['roster.loadingError'], { ns: 'agentRoster' })}</span>
            <Button size="small" variant="secondary" onClick={state.footer.onRetry}>
              {tCommon(($) => $['operation.retry'])}
            </Button>
          </div>
        )}
        {state.status === 'ready' && state.footer.status === 'load-more' && (
          <div className="flex justify-center pt-1">
            <Button loading={state.footer.isLoading} onClick={state.footer.onLoadMore}>
              {t(($) => $['roster.loadMore'], { ns: 'agentRoster' })}
            </Button>
          </div>
        )}
      </div>
      <Dialog
        handle={editDialog}
        disablePointerDismissal
        onOpenChange={(open, details) => {
          if (!open && agentUpdate.isPending && details.reason !== 'imperative-action')
            details.cancel()
        }}
        onOpenChangeComplete={(open) => {
          if (!open) agentUpdate.reset()
        }}
      >
        {({ payload }) =>
          payload && (
            <EditAgentDialogContent
              agent={payload}
              pending={agentUpdate.isPending}
              onSubmit={(body) => {
                if (agentUpdate.isPending) return
                agentUpdate.mutate(
                  { params: { agent_id: payload.id }, body },
                  { onSuccess: () => editDialog.close() },
                )
              }}
            />
          )
        }
      </Dialog>
      <Dialog
        handle={duplicateDialog}
        disablePointerDismissal
        onOpenChange={(open, details) => {
          if (!open && agentCopy.isPending && details.reason !== 'imperative-action')
            details.cancel()
        }}
        onOpenChangeComplete={(open) => {
          if (!open) agentCopy.reset()
        }}
      >
        {({ payload }) =>
          payload && (
            <DuplicateAgentDialogContent
              agent={payload}
              pending={agentCopy.isPending}
              onSubmit={(body) => {
                if (agentCopy.isPending) return
                agentCopy.mutate(
                  { params: { agent_id: payload.id }, body },
                  { onSuccess: () => duplicateDialog.close() },
                )
              }}
            />
          )
        }
      </Dialog>
      <AlertDialog
        handle={deleteDialog}
        onOpenChange={(open, details) => {
          if (!open && deletion.isPending && details.reason !== 'imperative-action')
            details.cancel()
        }}
        onOpenChangeComplete={(open) => {
          if (!open) deletion.reset()
        }}
      >
        {({ payload }) => (
          <AlertDialogContent
            finalFocus={() => {
              const fallback = payload?.fallbackFocus.current
              if (!fallback) return true
              const target =
                payload.adjacentFocusTargets.find((element) => element.isConnected) ?? fallback
              target.focus({ preventScroll: true })
              return false
            }}
          >
            {payload && (
              <DeleteAgentForm
                agentName={payload.name}
                isPending={deletion.isPending}
                error={
                  deletion.isError
                    ? describeRequestError(
                        deletion.error,
                        t(($) => $['roster.deleteFailed']),
                      )
                    : undefined
                }
                onSubmit={() => {
                  if (deletion.isPending) return
                  deletion.mutate(
                    { params: { agent_id: payload.id } },
                    {
                      onSuccess: () => {
                        payload.fallbackFocus.current = regionRef.current
                        deleteDialog.close()
                      },
                    },
                  )
                }}
              />
            )}
          </AlertDialogContent>
        )}
      </AlertDialog>
    </>
  )
}
