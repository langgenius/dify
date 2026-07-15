'use client'

import type {
  AgentConfigSnapshotSummaryResponse,
  AgentReferencingWorkflowResponse,
  AgentReferencingWorkflowsResponse,
} from '@dify/contracts/api/console/agent/types.gen'
import type { Hotkey } from '@tanstack/react-hotkeys'
import { Button } from '@langgenius/dify-ui/button'
import { Collapsible, CollapsiblePanel } from '@langgenius/dify-ui/collapsible'
import { Kbd, KbdGroup } from '@langgenius/dify-ui/kbd'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { toast } from '@langgenius/dify-ui/toast'
import { formatForDisplay, useHotkey } from '@tanstack/react-hotkeys'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  hasAgentComposerUnpublishedChangesAtom,
  isAgentComposerDirtyAtom,
} from '@/features/agent-v2/agent-composer/store'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import useTimestamp from '@/hooks/use-timestamp'
import { consoleQuery } from '@/service/client'
import { AgentPublishImpactDetails } from './publish-impact-details'

const PUBLISH_AGENT_HOTKEY = 'Mod+Shift+P' satisfies Hotkey

type AgentConfigurePublishState = 'draft' | 'publishing' | 'published' | 'unpublished'

type PublishBarMode =
  | { status: 'compact' }
  | { status: 'confirmingImpact'; references: AgentReferencingWorkflowResponse[] }

type AgentConfigurePublishBarProps = {
  agentId: string
  activeConfigIsPublished?: boolean
  activeConfigSnapshot?: AgentConfigSnapshotSummaryResponse | null
  agentName?: string | null
  draftSavedAt?: number
  isPublishing?: boolean
  selectedVersionSnapshot?: AgentConfigSnapshotSummaryResponse | null
  workflowReferencesEnabled?: boolean
  onPublish?: () => void | Promise<void>
  onExitVersions?: () => void
  onOpenVersions?: () => void
}

function getPublishState({
  activeConfigIsPublished,
  activeConfigSnapshot,
  hasLocalChanges,
  hasUnpublishedChanges,
  isPublishing,
}: {
  activeConfigIsPublished?: boolean
  activeConfigSnapshot?: AgentConfigSnapshotSummaryResponse | null
  hasLocalChanges: boolean
  hasUnpublishedChanges: boolean
  isPublishing: boolean
}): AgentConfigurePublishState {
  if (isPublishing) return 'publishing'

  if (hasLocalChanges) return 'unpublished'

  if (activeConfigIsPublished) return 'published'

  if (hasUnpublishedChanges) return 'unpublished'

  if (!activeConfigSnapshot) return 'draft'

  if (!activeConfigIsPublished) return 'unpublished'

  return 'published'
}

function PublishShortcut() {
  return (
    <KbdGroup aria-hidden>
      {PUBLISH_AGENT_HOTKEY.split('+').map((key) => (
        <Kbd key={key} color="white">
          {formatForDisplay(key)}
        </Kbd>
      ))}
    </KbdGroup>
  )
}

export function AgentConfigurePublishBar({
  agentId,
  activeConfigIsPublished,
  activeConfigSnapshot,
  agentName,
  draftSavedAt,
  isPublishing = false,
  selectedVersionSnapshot,
  workflowReferencesEnabled = true,
  onPublish,
  onExitVersions,
  onOpenVersions,
}: AgentConfigurePublishBarProps) {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const queryClient = useQueryClient()
  const [publishBarMode, setPublishBarMode] = useState<PublishBarMode>({ status: 'compact' })
  const lastKnownPublishedRef = useRef(false)
  if (activeConfigIsPublished === true) lastKnownPublishedRef.current = true
  if (activeConfigIsPublished === false) lastKnownPublishedRef.current = false
  const stableActiveConfigIsPublished =
    activeConfigIsPublished ?? (lastKnownPublishedRef.current ? true : undefined)
  const hasUnpublishedChanges = useAtomValue(hasAgentComposerUnpublishedChangesAtom)
  const hasLocalChanges = useAtomValue(isAgentComposerDirtyAtom)
  const publishableState = getPublishState({
    activeConfigIsPublished: stableActiveConfigIsPublished,
    activeConfigSnapshot,
    hasLocalChanges,
    hasUnpublishedChanges,
    isPublishing: false,
  })
  const publishState = getPublishState({
    activeConfigIsPublished: stableActiveConfigIsPublished,
    activeConfigSnapshot,
    hasLocalChanges,
    hasUnpublishedChanges,
    isPublishing,
  })
  const publishIsAvailable =
    !isPublishing && (publishableState === 'draft' || publishableState === 'unpublished')
  const workflowReferencesQueryOptions =
    consoleQuery.agent.byAgentId.referencingWorkflows.get.queryOptions({
      input: {
        params: {
          agent_id: agentId,
        },
      },
      enabled: workflowReferencesEnabled && publishIsAvailable && !selectedVersionSnapshot,
    })
  const workflowReferencesQuery = useQuery(workflowReferencesQueryOptions)
  const restoreVersionMutation = useMutation(
    consoleQuery.agent.byAgentId.versions.byVersionId.restore.post.mutationOptions(),
  )
  const canPublish = publishIsAvailable

  const handleRestoreVersion = (versionId: string) => {
    if (restoreVersionMutation.isPending) return

    restoreVersionMutation.mutate(
      {
        params: {
          agent_id: agentId,
          version_id: versionId,
        },
      },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({
            queryKey: consoleQuery.agent.byAgentId.get.queryKey({
              input: {
                params: {
                  agent_id: agentId,
                },
              },
            }),
          })
          void queryClient.invalidateQueries({
            queryKey: consoleQuery.agent.byAgentId.composer.get.queryKey({
              input: {
                params: {
                  agent_id: agentId,
                },
              },
            }),
          })
          void queryClient.invalidateQueries({
            queryKey: consoleQuery.agent.byAgentId.versions.get.key(),
          })
          onExitVersions?.()
          toast.success(tCommon(($) => $['api.actionSuccess']))
        },
        onError: () => {
          toast.error(tCommon(($) => $['api.actionFailed']))
        },
      },
    )
  }

  const handlePublish = async () => {
    if (!canPublish) return

    await onPublish?.()
    setPublishBarMode({ status: 'compact' })
  }

  const handlePublishRequest = async () => {
    if (!canPublish) return

    if (publishBarMode.status === 'confirmingImpact') {
      await handlePublish()
      return
    }

    const cachedReferences = queryClient.getQueryData<AgentReferencingWorkflowsResponse>(
      workflowReferencesQueryOptions.queryKey,
    )
    const references = workflowReferencesEnabled
      ? ((
          cachedReferences ??
          workflowReferencesQuery.data ??
          (await queryClient.ensureQueryData(workflowReferencesQueryOptions))
        )?.data ?? [])
      : []

    if (references.length > 0) {
      setPublishBarMode({ status: 'confirmingImpact', references })
      return
    }

    await handlePublish()
  }

  useHotkey(
    PUBLISH_AGENT_HOTKEY,
    (event) => {
      event.preventDefault()
      void handlePublishRequest()
    },
    {
      enabled: canPublish && !selectedVersionSnapshot,
      ignoreInputs: false,
    },
  )

  if (selectedVersionSnapshot) {
    return (
      <AgentVersionRestoreBar
        version={selectedVersionSnapshot}
        isRestoring={restoreVersionMutation.isPending}
        onExitVersions={onExitVersions}
        onRestoreVersion={handleRestoreVersion}
      />
    )
  }

  const publishedMeta = activeConfigSnapshot?.created_at
    ? t(($) => $['agentDetail.configure.publishBar.publishedAt'], {
        time: formatTimeFromNow(activeConfigSnapshot.created_at * 1000),
      })
    : t(($) => $['agentDetail.configure.publishBar.published'])
  const savedMeta = draftSavedAt
    ? t(($) => $['agentDetail.configure.publishBar.savedAt'], {
        time: formatTimeFromNow(draftSavedAt),
      })
    : t(($) => $['agentDetail.configure.publishBar.saved'])
  const stateMeta = {
    draft: {
      actionIcon: null,
      actionLabel: t(($) => $['agentDetail.publish']),
      dotStatus: 'disabled',
      metaLabel: savedMeta,
      showShortcut: true,
      statusLabel: t(($) => $['agentDetail.configure.publishBar.draft']),
    },
    publishing: {
      actionIcon: null,
      actionLabel: t(($) => $['agentDetail.configure.publishBar.publishing']),
      dotStatus: 'disabled',
      metaLabel: savedMeta,
      showShortcut: false,
      statusLabel: t(($) => $['agentDetail.configure.publishBar.draft']),
    },
    published: {
      actionIcon: 'i-ri-check-line',
      actionLabel: t(($) => $['agentDetail.configure.publishBar.published']),
      dotStatus: 'success',
      metaLabel: publishedMeta,
      showShortcut: false,
      statusLabel: t(($) => $['agentDetail.configure.publishBar.upToDate']),
    },
    unpublished: {
      actionIcon: null,
      actionLabel: t(($) => $['agentDetail.configure.publishBar.publishUpdate']),
      dotStatus: 'warning',
      metaLabel: savedMeta,
      showShortcut: true,
      statusLabel: t(($) => $['agentDetail.configure.publishBar.unpublishedChanges']),
    },
  } satisfies Record<
    AgentConfigurePublishState,
    {
      actionIcon: string | null
      actionLabel: string
      dotStatus: 'disabled' | 'success' | 'warning'
      metaLabel: string
      showShortcut: boolean
      statusLabel: string
    }
  >
  const currentStateMeta = stateMeta[publishState]
  const isConfirmingImpact =
    publishBarMode.status === 'confirmingImpact' && (canPublish || isPublishing)
  const impactReferences =
    publishBarMode.status === 'confirmingImpact' ? publishBarMode.references : []

  return (
    <Collapsible
      open={isConfirmingImpact}
      className="group/publish-bar pointer-events-auto w-full overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg shadow-shadow-shadow-5 backdrop-blur-[5px]"
    >
      <CollapsiblePanel className="system-sm-regular text-text-secondary">
        <AgentPublishImpactDetails
          publishActionLabel={currentStateMeta.actionLabel}
          agentName={agentName}
          references={impactReferences}
        />
      </CollapsiblePanel>
      <PublishBarActions
        actionIcon={currentStateMeta.actionIcon}
        actionLabel={currentStateMeta.actionLabel}
        dotStatus={currentStateMeta.dotStatus}
        isPublishing={isPublishing}
        metaLabel={currentStateMeta.metaLabel}
        showShortcut={currentStateMeta.showShortcut}
        statusLabel={currentStateMeta.statusLabel}
        canPublish={canPublish}
        onCancelImpact={() => setPublishBarMode({ status: 'compact' })}
        onOpenVersions={() => onOpenVersions?.()}
        onPublishRequest={handlePublishRequest}
      />
    </Collapsible>
  )
}

function PublishBarActions({
  actionIcon,
  actionLabel,
  dotStatus,
  isPublishing,
  metaLabel,
  showShortcut,
  statusLabel,
  canPublish,
  onCancelImpact,
  onOpenVersions,
  onPublishRequest,
}: {
  actionIcon: string | null
  actionLabel: string
  dotStatus: 'disabled' | 'success' | 'warning'
  isPublishing: boolean
  metaLabel: string
  showShortcut: boolean
  statusLabel: string
  canPublish: boolean
  onCancelImpact: () => void
  onOpenVersions: () => void
  onPublishRequest: () => void | Promise<void>
}) {
  const { t } = useTranslation('agentV2')

  return (
    <div className="flex w-full min-w-0 items-center justify-between gap-2 p-2 group-data-open/publish-bar:justify-end group-data-open/publish-bar:px-4 group-data-open/publish-bar:pt-2 group-data-open/publish-bar:pb-4">
      <div
        role="status"
        aria-label={`${statusLabel}. ${metaLabel}`}
        className="flex min-w-0 flex-1 items-center gap-1 px-2 system-xs-regular text-text-tertiary group-data-open/publish-bar:hidden"
      >
        <span className="flex size-4 shrink-0 items-center justify-center">
          <StatusDot size="small" status={dotStatus} />
        </span>
        <span className="shrink-0">{statusLabel}</span>
        <span aria-hidden className="shrink-0">
          ·
        </span>
        <span className="min-w-0 truncate">{metaLabel}</span>
      </div>
      <button
        type="button"
        aria-label={t(($) => $['agentDetail.configure.publishBar.versionHistory'])}
        className="flex size-8 shrink-0 items-center justify-center rounded-lg text-text-tertiary group-data-open/publish-bar:hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
        onClick={onOpenVersions}
      >
        <span aria-hidden className="i-ri-history-line size-4" />
      </button>
      <Button
        type="button"
        variant="secondary"
        className="hidden h-8 min-w-18 rounded-lg px-3 group-data-open/publish-bar:inline-flex"
        onClick={onCancelImpact}
      >
        {t(($) => $['agentDetail.configure.publishImpact.cancel'])}
      </Button>
      <Button
        type="button"
        variant="primary"
        disabled={!canPublish}
        loading={isPublishing}
        className="h-8 gap-1 rounded-lg px-3"
        onClick={() => {
          void onPublishRequest()
        }}
      >
        {actionIcon && <span aria-hidden className={`${actionIcon} size-4 shrink-0`} />}
        <span className="shrink-0">{actionLabel}</span>
        {showShortcut && <PublishShortcut />}
      </Button>
    </div>
  )
}

function AgentVersionRestoreBar({
  version,
  isRestoring = false,
  onExitVersions,
  onRestoreVersion,
}: {
  version: AgentConfigSnapshotSummaryResponse
  isRestoring?: boolean
  onExitVersions?: () => void
  onRestoreVersion?: (versionId: string) => void
}) {
  const { t } = useTranslation('agentV2')
  const { formatTime } = useTimestamp()
  const versionLabel =
    version.version_note ||
    t(($) => $['agentDetail.versionHistory.versionName'], { version: version.version })
  const createdAt =
    version.created_at == null
      ? null
      : formatTime(
          version.created_at,
          t(($) => $['roster.dateTimeFormat']),
        )

  return (
    <div className="pointer-events-auto flex max-w-full min-w-0 items-center gap-2 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur py-2 pr-2.5 pl-2 shadow-lg shadow-shadow-shadow-5 backdrop-blur-[5px]">
      <div className="flex min-w-0 flex-col justify-center gap-0.5 pr-4 pl-2">
        <div className="flex min-w-0 items-center gap-1">
          <p className="min-w-0 truncate system-sm-semibold text-text-primary">{versionLabel}</p>
          <span className="shrink-0 rounded-[5px] border border-text-accent-secondary bg-components-badge-bg-dimm px-1 py-0.5 system-2xs-medium-uppercase text-text-accent-secondary">
            {t(($) => $['agentDetail.versionHistory.viewOnly'])}
          </span>
        </div>
        {(createdAt || version.created_by) && (
          <p className="min-w-0 truncate system-xs-regular text-text-tertiary">
            {createdAt}
            {createdAt && version.created_by && ' · '}
            {version.created_by}
          </p>
        )}
      </div>
      <Button
        type="button"
        variant="primary"
        disabled={!onRestoreVersion}
        loading={isRestoring}
        className="h-8 rounded-lg px-3"
        onClick={() => onRestoreVersion?.(version.id)}
      >
        {t(($) => $['agentDetail.versionHistory.restore'])}
      </Button>
      <Button
        type="button"
        variant="secondary"
        className="h-8 gap-1 rounded-lg px-3 text-text-accent"
        onClick={onExitVersions}
      >
        <span aria-hidden className="i-ri-arrow-go-back-line size-4 shrink-0" />
        <span className="shrink-0">{t(($) => $['agentDetail.versionHistory.exitVersions'])}</span>
      </Button>
    </div>
  )
}
