'use client'

import type { AgentConfigSnapshotDetailResponse, AgentConfigSnapshotSummaryResponse, AgentSoulConfig } from '@dify/contracts/api/console/agent/types.gen'
import type { RegisterableHotkey } from '@tanstack/react-hotkeys'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Kbd, KbdGroup } from '@langgenius/dify-ui/kbd'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { formatForDisplay } from '@tanstack/react-hotkeys'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useConfigPublishPayload, useHasAgentComposerUnpublishedChanges } from '@/features/agent-v2/agent-composer/store'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import useTimestamp from '@/hooks/use-timestamp'
import { AgentPublishImpactPopover } from './publish-impact-popover'

const PUBLISH_AGENT_HOTKEY = 'Mod+Shift+P' satisfies RegisterableHotkey
const PUBLISH_IMPACT_BAR_HIDE_DELAY = 160

export type AgentConfigurePublishPayload = {
  agent_id: string
  config_snapshot: AgentSoulConfig
}

type AgentConfigurePublishState = 'draft' | 'publishing' | 'published' | 'unpublished'

type AgentConfigurePublishBarProps = {
  agentId: string
  activeConfigIsPublished?: boolean
  activeConfigSnapshot?: AgentConfigSnapshotSummaryResponse | null
  agentSoulConfig?: AgentConfigSnapshotDetailResponse['config_snapshot']
  agentName?: string | null
  currentModel?: {
    provider: string
    model: string
  }
  draftSavedAt?: number
  isPublishing?: boolean
  selectedVersionSnapshot?: AgentConfigSnapshotSummaryResponse | null
  onPublish?: (payload: AgentConfigurePublishPayload) => void | Promise<void>
  onExitVersions?: () => void
  onOpenVersions: () => void
}

function getPublishState({
  activeConfigIsPublished,
  activeConfigSnapshot,
  isDirty,
  isPublishing,
}: {
  activeConfigIsPublished?: boolean
  activeConfigSnapshot?: AgentConfigSnapshotSummaryResponse | null
  isDirty: boolean
  isPublishing: boolean
}): AgentConfigurePublishState {
  if (isPublishing)
    return 'publishing'

  if (!activeConfigSnapshot)
    return 'draft'

  if (!activeConfigIsPublished || isDirty)
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
  activeConfigIsPublished,
  activeConfigSnapshot,
  agentSoulConfig,
  agentName,
  currentModel,
  draftSavedAt,
  isPublishing = false,
  selectedVersionSnapshot,
  onPublish,
  onExitVersions,
  onOpenVersions,
}: AgentConfigurePublishBarProps) {
  const { t } = useTranslation('agentV2')
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const [shouldHidePublishBar, setShouldHidePublishBar] = useState(false)
  const hidePublishBarTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const hasUnpublishedChanges = useHasAgentComposerUnpublishedChanges()
  const publishPayload = useConfigPublishPayload({
    agentId,
    baseConfig: agentSoulConfig,
    currentModel,
  })
  const publishState = getPublishState({
    activeConfigIsPublished,
    activeConfigSnapshot,
    isDirty: hasUnpublishedChanges,
    isPublishing,
  })
  const canPublish = publishState === 'draft' || publishState === 'unpublished'

  const handleImpactPopoverOpenChange = (open: boolean) => {
    if (hidePublishBarTimerRef.current)
      clearTimeout(hidePublishBarTimerRef.current)

    if (!open) {
      setShouldHidePublishBar(false)
      return
    }

    hidePublishBarTimerRef.current = setTimeout(() => {
      setShouldHidePublishBar(true)
    }, PUBLISH_IMPACT_BAR_HIDE_DELAY)
  }

  const handlePublish = () => {
    if (!canPublish)
      return

    void onPublish?.(publishPayload)
  }

  useEffect(() => {
    return () => {
      if (hidePublishBarTimerRef.current)
        clearTimeout(hidePublishBarTimerRef.current)
    }
  }, [])

  if (selectedVersionSnapshot) {
    return (
      <AgentVersionRestoreBar
        version={selectedVersionSnapshot}
        onExitVersions={onExitVersions}
      />
    )
  }

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
      <div
        className={cn(
          'flex max-w-full min-w-0 items-center gap-2 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-2 shadow-lg shadow-shadow-shadow-5 backdrop-blur-[5px]',
          shouldHidePublishBar && 'pointer-events-none opacity-0',
        )}
        aria-hidden={shouldHidePublishBar}
      >
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
          actionShortcut={currentStateMeta.showShortcut ? <PublishShortcut /> : null}
          hotkey={PUBLISH_AGENT_HOTKEY}
          agentId={agentId}
          agentName={agentName}
          disabled={!canPublish}
          onOpenChange={handleImpactPopoverOpenChange}
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

function AgentVersionRestoreBar({
  version,
  onExitVersions,
}: {
  version: AgentConfigSnapshotSummaryResponse
  onExitVersions?: () => void
}) {
  const { t } = useTranslation('agentV2')
  const { formatTime } = useTimestamp()
  const versionLabel = version.version_note || t('agentDetail.versionHistory.versionName', { version: version.version })
  const createdAt = version.created_at == null
    ? null
    : formatTime(version.created_at, t('roster.dateTimeFormat'))

  return (
    <div className="flex h-16 shrink-0 items-center justify-center px-4 pt-2 pb-3">
      <div className="flex max-w-full min-w-0 items-center gap-2 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur py-2 pr-2.5 pl-2 shadow-lg shadow-shadow-shadow-5 backdrop-blur-[5px]">
        <div className="flex min-w-0 flex-col justify-center gap-0.5 pr-4 pl-2">
          <div className="flex min-w-0 items-center gap-1">
            <p className="min-w-0 truncate system-sm-semibold text-text-primary">
              {versionLabel}
            </p>
            <span className="shrink-0 rounded-[5px] border border-text-accent-secondary bg-components-badge-bg-dimm px-1 py-0.5 system-2xs-medium-uppercase text-text-accent-secondary">
              {t('agentDetail.versionHistory.viewOnly')}
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
          disabled
          className="h-8 rounded-lg px-3"
        >
          {t('agentDetail.versionHistory.restore')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="h-8 gap-1 rounded-lg px-3 text-text-accent"
          onClick={onExitVersions}
        >
          <span aria-hidden className="i-ri-arrow-go-back-line size-4 shrink-0" />
          <span className="shrink-0">{t('agentDetail.versionHistory.exitVersions')}</span>
        </Button>
      </div>
    </div>
  )
}
