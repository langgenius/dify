'use client'

import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { useHotkey } from '@tanstack/react-hotkeys'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue, useSetAtom } from 'jotai'
import { useEffect, useRef, useState } from 'react'
import EnvNav from '@/app/components/header/env-nav'
import AccountSection from '@/app/components/main-nav/components/account-section'
import HelpMenu from '@/app/components/main-nav/components/help-menu'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { DETAIL_SIDEBAR_TOGGLE_HOTKEY } from './hotkeys'
import { detailSidebarModeAtom, setDetailSidebarModeAtom } from './state'

type DetailSidebarRenderProps = {
  expand: boolean
  onToggle: () => void
}

type DetailSidebarFrameProps = {
  className?: string
  compact?: boolean
  renderTop: (props: DetailSidebarRenderProps) => ReactNode
  renderSection: (props: Pick<DetailSidebarRenderProps, 'expand'>) => ReactNode
}

type SidebarView = 'collapsed' | 'preview' | 'expanded'

const secondarySidebarHelpTriggerIcon = (
  <span aria-hidden className="i-ri-question-line size-4 shrink-0" />
)

function SecondarySidebarHelpMenu({ triggerClassName }: { triggerClassName?: string }) {
  return (
    <HelpMenu
      triggerIcon={secondarySidebarHelpTriggerIcon}
      triggerSize="lg"
      triggerClassName={triggerClassName}
    />
  )
}

export function DetailSidebarFrame({
  className,
  compact = false,
  renderTop,
  renderSection,
}: DetailSidebarFrameProps) {
  const { data: currentEnv } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.meta.currentEnv,
  })
  const storedMode = useAtomValue(detailSidebarModeAtom)
  const setStoredMode = useSetAtom(setDetailSidebarModeAtom)
  const [compactExpanded, setCompactExpanded] = useState(false)
  const [hoverPreviewOpen, setHoverPreviewOpen] = useState(false)
  const closePreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  if (compact && hoverPreviewOpen) setHoverPreviewOpen(false)
  const expanded = compact ? compactExpanded : storedMode === 'expand'
  const sidebarView: SidebarView = expanded
    ? 'expanded'
    : !compact && hoverPreviewOpen
      ? 'preview'
      : 'collapsed'
  const visibleExpanded = sidebarView !== 'collapsed'
  const showEnvTag = currentEnv === 'TESTING' || currentEnv === 'DEVELOPMENT'

  function handleToggleDetailNavigation() {
    if (compact) {
      setCompactExpanded((expanded) => !expanded)
      return
    }

    if (sidebarView === 'preview') {
      setHoverPreviewOpen(false)
      setStoredMode('expand')
      return
    }

    setHoverPreviewOpen(false)
    setStoredMode(expanded ? 'collapse' : 'expand')
  }

  function cancelClosePreview() {
    if (closePreviewTimerRef.current) {
      clearTimeout(closePreviewTimerRef.current)
      closePreviewTimerRef.current = null
    }
  }

  function openHoverPreview() {
    if (compact || expanded) return

    cancelClosePreview()
    setHoverPreviewOpen(true)
  }

  function closeHoverPreview() {
    cancelClosePreview()

    closePreviewTimerRef.current = setTimeout(() => {
      setHoverPreviewOpen(false)
    }, 120)
  }

  useEffect(() => {
    return () => {
      if (closePreviewTimerRef.current) clearTimeout(closePreviewTimerRef.current)
    }
  }, [])

  useHotkey(
    DETAIL_SIDEBAR_TOGGLE_HOTKEY,
    (event) => {
      if (event.defaultPrevented) return

      event.preventDefault()
      event.stopPropagation()
      if (event.repeat) return
      handleToggleDetailNavigation()
    },
    {
      ignoreInputs: true,
      preventDefault: false,
      stopPropagation: false,
    },
  )

  return (
    <div
      className={cn(
        'relative flex h-full w-16 min-w-0 shrink-0 bg-background-body p-1 transition-[width] motion-reduce:transition-none',
        'data-[sidebar-view=expanded]:w-62',
        className,
      )}
      data-sidebar-view={sidebarView}
      onMouseEnter={cancelClosePreview}
      onMouseLeave={sidebarView === 'preview' ? closeHoverPreview : undefined}
    >
      <div
        className={cn(
          'flex min-h-0 w-14 shrink-0 flex-col overflow-hidden rounded-lg bg-components-panel-bg',
          'data-visible-expanded:z-40 data-visible-expanded:w-60',
          'data-preview:absolute data-preview:inset-y-1 data-preview:left-1',
          'data-preview:bg-components-panel-bg-blur data-preview:shadow-[0px_12px_16px_0px_var(--color-shadow-shadow-5),0px_4px_6px_0px_var(--color-shadow-shadow-1)] data-preview:backdrop-blur-[5px]',
        )}
        data-visible-expanded={visibleExpanded || undefined}
        data-preview={sidebarView === 'preview' || undefined}
      >
        <div className="flex min-h-0 flex-1 flex-col" onMouseEnter={openHoverPreview}>
          {renderTop({
            expand: visibleExpanded,
            onToggle: handleToggleDetailNavigation,
          })}
          {renderSection({
            expand: visibleExpanded,
          })}
          {showEnvTag && visibleExpanded && (
            <div className="mt-auto shrink-0 px-3 pb-2">
              <EnvNav />
            </div>
          )}
        </div>
        <div
          className={cn(
            'flex w-full shrink-0 flex-col items-center gap-0.5 rounded-lg px-2 pt-1 pb-3',
            'data-visible-expanded:flex-row data-visible-expanded:justify-between data-visible-expanded:gap-0 data-visible-expanded:p-3',
          )}
          data-visible-expanded={visibleExpanded || undefined}
        >
          {!visibleExpanded ? (
            <>
              <SecondarySidebarHelpMenu triggerClassName="mb-2" />
              <AccountSection compact />
            </>
          ) : (
            <>
              <div className="flex min-w-0 items-center gap-1 overflow-hidden">
                <AccountSection />
              </div>
              <SecondarySidebarHelpMenu />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
