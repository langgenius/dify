'use client'

import type { AgentConfigSnapshotDetailResponse, AgentConfigSnapshotSummaryResponse, AgentPublishedReferenceResponse, AgentSoulConfig } from '@dify/contracts/api/console/agent/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Kbd, KbdGroup } from '@langgenius/dify-ui/kbd'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { formatForDisplay, useHotkey } from '@tanstack/react-hotkeys'
import { useTranslation } from 'react-i18next'
import { useConfigPublishPayload, useHasAgentComposerUnpublishedChanges } from '@/features/agent-v2/agent-composer/store'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import { AgentPublishImpactPopover } from './publish-impact-popover'

const PUBLISH_AGENT_HOTKEY = 'Mod+Shift+P'

export type AgentConfigurePublishPayload = {
  agent_id: string
  config_snapshot: AgentSoulConfig
}

type AgentConfigurePublishState = 'draft' | 'publishing' | 'published' | 'unpublished'

type AgentConfigurePublishBarProps = {
  agentId: string
  activeConfigSnapshot?: AgentConfigSnapshotSummaryResponse | null
  agentSoulConfig?: AgentConfigSnapshotDetailResponse['config_snapshot']
  agentName?: string | null
  currentModel?: {
    provider: string
    model: string
  }
  draftSavedAt?: number
  isPublishing?: boolean
  publishedReferenceCount?: number
  publishedReferences?: AgentPublishedReferenceResponse[]
  onPublish?: (payload: AgentConfigurePublishPayload) => void | Promise<void>
  onOpenVersions: () => void
}

function getPublishState({
  activeConfigSnapshot,
  isDirty,
  isPublishing,
}: {
  activeConfigSnapshot?: AgentConfigSnapshotSummaryResponse | null
  isDirty: boolean
  isPublishing: boolean
}): AgentConfigurePublishState {
  if (isPublishing)
    return 'publishing'

  if (!activeConfigSnapshot)
    return 'draft'

  if (isDirty)
    return 'unpublished'

  return 'published'
}

function PublishShortcut() {
  return (
    <KbdGroup aria-hidden>
      {PUBLISH_AGENT_HOTKEY.split('+').map(key => (
        <Kbd key={key} color="white">{formatForDisplay(key)}</Kbd>
      ))}
    </KbdGroup>
  )
}

export function AgentConfigurePublishBar({
  agentId,
  activeConfigSnapshot,
  agentSoulConfig,
  agentName,
  currentModel,
  draftSavedAt,
  isPublishing = false,
  publishedReferenceCount = 0,
  publishedReferences = [],
  onPublish,
  onOpenVersions,
}: AgentConfigurePublishBarProps) {
  const { t } = useTranslation('agentV2')
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const hasUnpublishedChanges = useHasAgentComposerUnpublishedChanges()
  const publishPayload = useConfigPublishPayload({
    agentId,
    baseConfig: agentSoulConfig,
    currentModel,
  })
  const publishState = getPublishState({
    activeConfigSnapshot,
    isDirty: hasUnpublishedChanges,
    isPublishing,
  })
  const canPublish = publishState === 'draft' || publishState === 'unpublished'

  const handlePublish = () => {
    if (!canPublish)
      return

    void onPublish?.(publishPayload)
  }

  useHotkey(PUBLISH_AGENT_HOTKEY, (event) => {
    event.preventDefault()
    handlePublish()
  }, {
    enabled: canPublish,
    ignoreInputs: false,
  })

  const publishedMeta = activeConfigSnapshot?.created_at
    ? t('agentDetail.configure.publishBar.publishedAt', {
        time: formatTimeFromNow(activeConfigSnapshot.created_at * 1000),
      })
    : t('agentDetail.configure.publishBar.published')
  const savedMeta = draftSavedAt
    ? t('agentDetail.configure.publishBar.savedAt', {
        time: formatTimeFromNow(draftSavedAt),
      })
    : t('agentDetail.configure.publishBar.saved')
  const stateMeta = {
    draft: {
      actionIcon: null,
      actionLabel: t('agentDetail.publish'),
      dotStatus: 'disabled',
      metaLabel: savedMeta,
      showShortcut: true,
      statusLabel: t('agentDetail.configure.publishBar.draft'),
    },
    publishing: {
      actionIcon: 'i-ri-loader-2-line animate-spin motion-reduce:animate-none',
      actionLabel: t('agentDetail.configure.publishBar.publishing'),
      dotStatus: 'disabled',
      metaLabel: savedMeta,
      showShortcut: false,
      statusLabel: t('agentDetail.configure.publishBar.draft'),
    },
    published: {
      actionIcon: 'i-ri-check-line',
      actionLabel: t('agentDetail.configure.publishBar.published'),
      dotStatus: 'success',
      metaLabel: publishedMeta,
      showShortcut: false,
      statusLabel: t('agentDetail.configure.publishBar.upToDate'),
    },
    unpublished: {
      actionIcon: null,
      actionLabel: t('agentDetail.configure.publishBar.publishUpdate'),
      dotStatus: 'warning',
      metaLabel: savedMeta,
      showShortcut: true,
      statusLabel: t('agentDetail.configure.publishBar.unpublishedChanges'),
    },
  } satisfies Record<AgentConfigurePublishState, {
    actionIcon: string | null
    actionLabel: string
    dotStatus: 'disabled' | 'success' | 'warning'
    metaLabel: string
    showShortcut: boolean
    statusLabel: string
  }>
  const currentStateMeta = stateMeta[publishState]

  return (
    <div className="flex h-16 shrink-0 items-center justify-center px-4 pt-2 pb-3">
      <div className="flex max-w-full min-w-0 items-center gap-2 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-2 shadow-lg shadow-shadow-shadow-5 backdrop-blur-[5px]">
        <div className="flex min-w-0 items-center gap-1 px-2 system-xs-regular text-text-tertiary">
          <span className="flex size-4 shrink-0 items-center justify-center">
            <StatusDot size="small" status={currentStateMeta.dotStatus} />
          </span>
          <span className="shrink-0">{currentStateMeta.statusLabel}</span>
          <span aria-hidden className="shrink-0">·</span>
          <span className="min-w-0 truncate">
            {currentStateMeta.metaLabel}
          </span>
        </div>
        <button
          type="button"
          aria-label={t('agentDetail.configure.publishBar.versionHistory')}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          onClick={onOpenVersions}
        >
          <span aria-hidden className="i-ri-history-line size-4" />
        </button>
        <AgentPublishImpactPopover
          actionLabel={currentStateMeta.actionLabel}
          agentName={agentName}
          disabled={!canPublish}
          publishedReferenceCount={publishedReferenceCount}
          publishedReferences={publishedReferences}
          onPublish={handlePublish}
          trigger={(
            <Button
              type="button"
              variant="primary"
              aria-disabled={!canPublish}
              className="h-8 gap-1 rounded-lg px-3 aria-disabled:cursor-not-allowed"
              onClick={handlePublish}
            >
              {currentStateMeta.actionIcon && (
                <span aria-hidden className={cn('size-4 shrink-0', currentStateMeta.actionIcon)} />
              )}
              <span className="shrink-0">{currentStateMeta.actionLabel}</span>
              {currentStateMeta.showShortcut && <PublishShortcut />}
            </Button>
          )}
        />
      </div>
    </div>
  )
}
