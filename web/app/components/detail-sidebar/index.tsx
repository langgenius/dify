'use client'

import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { useHotkey } from '@tanstack/react-hotkeys'
import { useAtomValue } from 'jotai'
import { useEffect, useRef, useState } from 'react'
import EnvNav from '@/app/components/header/env-nav'
import AccountSection from '@/app/components/main-nav/components/account-section'
import HelpMenu from '@/app/components/main-nav/components/help-menu'
import { langGeniusVersionInfoAtom } from '@/context/version-state'
import { DETAIL_SIDEBAR_TOGGLE_HOTKEY } from './hotkeys'
import { useDetailSidebarMode } from './storage'

type DetailSidebarRenderProps = {
  expand: boolean
  onToggle: () => void
}

type DetailSidebarFrameProps = {
  className?: string
  renderTop: (props: DetailSidebarRenderProps) => ReactNode
  renderSection: (props: Pick<DetailSidebarRenderProps, 'expand'>) => ReactNode
}

const secondarySidebarHelpTriggerIcon = (
  <span aria-hidden className="i-ri-question-line size-4 shrink-0" />
)

function SecondarySidebarHelpMenu({ triggerClassName }: { triggerClassName?: string }) {
  return (
    <HelpMenu triggerIcon={secondarySidebarHelpTriggerIcon} triggerClassName={triggerClassName} />
  )
}

export function DetailSidebarFrame({
  className,
  renderTop,
  renderSection,
}: DetailSidebarFrameProps) {
  const langGeniusVersionInfo = useAtomValue(langGeniusVersionInfoAtom)
  const [storedDetailSidebarExpand, setStoredDetailSidebarExpand] = useDetailSidebarMode()
  const detailNavigationMode = storedDetailSidebarExpand === 'collapse' ? 'collapse' : 'expand'
  const detailNavigationExpanded = detailNavigationMode === 'expand'
  const [detailNavigationHoverPreviewOpen, setDetailNavigationHoverPreviewOpen] = useState(false)
  const [detailNavigationTransitionDisabled, setDetailNavigationTransitionDisabled] =
    useState(false)
  const closeDetailNavigationHoverPreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  )
  const detailNavigationTransitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isDetailNavigationHoverPreviewOpen =
    !detailNavigationExpanded && detailNavigationHoverPreviewOpen
  const detailNavigationVisibleExpanded =
    detailNavigationExpanded || isDetailNavigationHoverPreviewOpen
  const bottomNavigationExpanded = detailNavigationVisibleExpanded
  const currentEnv = langGeniusVersionInfo?.current_env
  const showEnvTag = currentEnv === 'TESTING' || currentEnv === 'DEVELOPMENT'

  function handleToggleDetailNavigation() {
    if (isDetailNavigationHoverPreviewOpen) {
      if (detailNavigationTransitionTimerRef.current)
        clearTimeout(detailNavigationTransitionTimerRef.current)

      setDetailNavigationTransitionDisabled(true)
      setDetailNavigationHoverPreviewOpen(false)
      setStoredDetailSidebarExpand('expand')
      detailNavigationTransitionTimerRef.current = setTimeout(() => {
        setDetailNavigationTransitionDisabled(false)
      }, 200)
      return
    }

    const nextMode = detailNavigationExpanded ? 'collapse' : 'expand'
    setDetailNavigationHoverPreviewOpen(false)
    setStoredDetailSidebarExpand(nextMode)
  }

  function openDetailNavigationHoverPreview() {
    if (detailNavigationExpanded) return

    if (closeDetailNavigationHoverPreviewTimerRef.current)
      clearTimeout(closeDetailNavigationHoverPreviewTimerRef.current)

    setDetailNavigationHoverPreviewOpen(true)
  }

  function closeDetailNavigationHoverPreview() {
    if (closeDetailNavigationHoverPreviewTimerRef.current)
      clearTimeout(closeDetailNavigationHoverPreviewTimerRef.current)

    closeDetailNavigationHoverPreviewTimerRef.current = setTimeout(() => {
      setDetailNavigationHoverPreviewOpen(false)
    }, 120)
  }

  useEffect(() => {
    return () => {
      if (closeDetailNavigationHoverPreviewTimerRef.current)
        clearTimeout(closeDetailNavigationHoverPreviewTimerRef.current)
      if (detailNavigationTransitionTimerRef.current)
        clearTimeout(detailNavigationTransitionTimerRef.current)
    }
  }, [])

  useHotkey(DETAIL_SIDEBAR_TOGGLE_HOTKEY, handleToggleDetailNavigation, {
    ignoreInputs: false,
    preventDefault: true,
  })

  return (
    <aside
      className={cn(
        'relative flex h-full shrink-0 bg-background-body p-1',
        detailNavigationTransitionDisabled ? 'transition-none' : 'transition-all',
        isDetailNavigationHoverPreviewOpen
          ? 'w-16 overflow-visible'
          : detailNavigationExpanded
            ? 'w-62 overflow-hidden'
            : 'w-16 overflow-hidden',
        className,
      )}
    >
      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col',
          isDetailNavigationHoverPreviewOpen
            ? 'absolute top-1 bottom-1 left-1 z-40 w-60 overflow-hidden rounded-lg border border-divider-subtle bg-components-panel-bg shadow-lg'
            : 'overflow-hidden rounded-lg bg-components-panel-bg',
          detailNavigationVisibleExpanded ? 'w-60' : 'w-14',
        )}
        onMouseEnter={!detailNavigationExpanded ? openDetailNavigationHoverPreview : undefined}
        onMouseLeave={!detailNavigationExpanded ? closeDetailNavigationHoverPreview : undefined}
      >
        <div className="flex min-h-0 flex-1 flex-col">
          {renderTop({
            expand: detailNavigationVisibleExpanded,
            onToggle: handleToggleDetailNavigation,
          })}
          {renderSection({
            expand: detailNavigationVisibleExpanded,
          })}
          {showEnvTag && detailNavigationVisibleExpanded && (
            <div className="relative z-30 mt-auto shrink-0 px-3 pb-2">
              <EnvNav />
            </div>
          )}
        </div>
        <div
          className={cn(
            !bottomNavigationExpanded
              ? 'flex w-full shrink-0 flex-col items-center gap-0.5 rounded-lg px-2 pt-1 pb-3'
              : 'flex w-60 items-center justify-between bg-components-panel-bg py-3 pr-1 pl-3',
          )}
        >
          {!bottomNavigationExpanded ? (
            <>
              <SecondarySidebarHelpMenu triggerClassName="mb-2" />
              <AccountSection compact />
            </>
          ) : (
            <>
              <div className="flex min-w-0 items-center gap-1 overflow-hidden">
                <AccountSection />
              </div>
              <div className="flex shrink-0 items-center justify-center rounded-full p-1">
                <SecondarySidebarHelpMenu />
              </div>
            </>
          )}
        </div>
      </div>
    </aside>
  )
}
