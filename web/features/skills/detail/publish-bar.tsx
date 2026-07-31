'use client'

import type { Hotkey } from '@tanstack/react-hotkeys'
import type { ReactNode } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { Kbd, KbdGroup } from '@langgenius/dify-ui/kbd'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { formatForDisplay, useHotkey } from '@tanstack/react-hotkeys'
import { useTranslation } from 'react-i18next'

const PUBLISH_SKILL_HOTKEY = 'Mod+Shift+P' satisfies Hotkey

export type SkillPublishState = 'draft' | 'publishing' | 'published' | 'unpublished'

type SkillPublishBarProps = {
  children?: ReactNode
  metaLabel: string
  onOpenVersions: () => void
  onPublish: () => void
  state: SkillPublishState
}

export function SkillPublishShortcut() {
  return (
    <KbdGroup aria-hidden>
      {PUBLISH_SKILL_HOTKEY.split('+').map((key) => (
        <Kbd key={key} color="white">
          {formatForDisplay(key)}
        </Kbd>
      ))}
    </KbdGroup>
  )
}

export function SkillPublishBar({
  children,
  metaLabel,
  onOpenVersions,
  onPublish,
  state,
}: SkillPublishBarProps) {
  const { t } = useTranslation('skill')
  const canPublish = state === 'draft' || state === 'unpublished'

  useHotkey(PUBLISH_SKILL_HOTKEY, onPublish, {
    enabled: canPublish,
    ignoreInputs: false,
  })

  const stateMeta = {
    draft: {
      actionLabel: t(($) => $['skillManagement.detail.publish']),
      dotStatus: 'disabled',
      showShortcut: true,
      statusLabel: t(($) => $['skillManagement.detail.draft']),
    },
    publishing: {
      actionLabel: t(($) => $['skillManagement.detail.publishing']),
      dotStatus: 'disabled',
      showShortcut: false,
      statusLabel: t(($) => $['skillManagement.detail.draft']),
    },
    published: {
      actionLabel: t(($) => $['skillManagement.detail.published']),
      dotStatus: 'success',
      showShortcut: false,
      statusLabel: t(($) => $['skillManagement.detail.upToDate']),
    },
    unpublished: {
      actionLabel: t(($) => $['skillManagement.detail.publishUpdate']),
      dotStatus: 'warning',
      showShortcut: true,
      statusLabel: t(($) => $['skillManagement.detail.unpublishedChanges']),
    },
  } satisfies Record<
    SkillPublishState,
    {
      actionLabel: string
      dotStatus: 'disabled' | 'success' | 'warning'
      showShortcut: boolean
      statusLabel: string
    }
  >
  const currentState = stateMeta[state]

  return (
    <div
      data-testid="skill-publish-bar"
      className="pointer-events-auto relative flex h-12 max-w-[calc(100%-2rem)] items-center gap-2 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-2 shadow-lg shadow-shadow-shadow-5 backdrop-blur-[5px]"
    >
      {children}
      <div
        role="status"
        aria-label={`${currentState.statusLabel}. ${metaLabel}`}
        className="flex min-w-0 items-center gap-1 px-2 system-xs-regular whitespace-nowrap text-text-tertiary"
      >
        <span className="flex size-4 shrink-0 items-center justify-center">
          <StatusDot size="small" status={currentState.dotStatus} />
        </span>
        <span>{currentState.statusLabel}</span>
        <span aria-hidden>·</span>
        <span className="truncate">{metaLabel}</span>
      </div>
      <button
        type="button"
        aria-label={t(($) => $['skillManagement.detail.versionHistory'])}
        className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
        onClick={onOpenVersions}
      >
        <span aria-hidden className="i-ri-history-line size-4" />
      </button>
      <Button
        type="button"
        variant="primary"
        disabled={state === 'published'}
        aria-disabled={state === 'publishing'}
        className="h-8 gap-1 rounded-lg px-3"
        onClick={canPublish ? onPublish : undefined}
      >
        {state === 'publishing' && (
          <span aria-hidden className="i-ri-loader-2-line size-4 shrink-0 animate-spin" />
        )}
        {state === 'published' && <span aria-hidden className="i-ri-check-line size-4 shrink-0" />}
        <span className="shrink-0">{currentState.actionLabel}</span>
        {currentState.showShortcut && <SkillPublishShortcut />}
      </Button>
    </div>
  )
}
