'use client'
import type {
  OffsetOptions,
  Placement,
} from '@floating-ui/react'
import type { FC } from 'react'
import type { App } from '@/types/app'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import * as React from 'react'
import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import Input from '@/app/components/base/input'
import { AppModeEnum } from '@/types/app'

type Props = {
  scope: string
  disabled: boolean
  trigger: React.ReactNode
  placement?: Placement
  offset?: OffsetOptions
  isShow: boolean
  onShowChange: (isShow: boolean) => void
  onSelect: (app: App) => void
  apps: App[]
  isLoading: boolean
  hasMore: boolean
  onLoadMore: () => void
  searchText: string
  onSearchChange: (text: string) => void
}

const AppPicker: FC<Props> = ({
  scope: _scope,
  disabled,
  trigger,
  placement = 'right-start',
  offset = 0,
  isShow,
  onShowChange,
  onSelect,
  apps,
  isLoading,
  hasMore,
  onLoadMore,
  searchText,
  onSearchChange,
}) => {
  const { t } = useTranslation()
  const observerTargetRef = useRef<HTMLDivElement>(null)
  const observerRef = useRef<IntersectionObserver | null>(null)
  const loadingRef = useRef(false)
  const loadingResetTimerIdRef = useRef<number | undefined>(undefined)

  const retimeLoadingReset = useCallback((timerId?: number) => {
    if (loadingResetTimerIdRef.current !== undefined)
      globalThis.clearTimeout(loadingResetTimerIdRef.current)

    loadingResetTimerIdRef.current = timerId
  }, [])

  const resetLoadingState = useCallback(() => {
    retimeLoadingReset()
    loadingRef.current = false
  }, [retimeLoadingReset])

  const disconnectObserver = useCallback(() => {
    if (!observerRef.current)
      return

    observerRef.current.disconnect()
    observerRef.current = null
  }, [])

  const handleIntersection = useCallback((entries: IntersectionObserverEntry[]) => {
    const target = entries[0]
    if (!target!.isIntersecting || loadingRef.current || !hasMore || isLoading)
      return

    loadingRef.current = true
    onLoadMore()
    retimeLoadingReset(window.setTimeout(() => {
      loadingRef.current = false
      retimeLoadingReset()
    }, 500))
  }, [hasMore, isLoading, onLoadMore, retimeLoadingReset])

  useEffect(() => {
    if (!isShow) {
      resetLoadingState()
      disconnectObserver()
      return
    }

    let mutationObserver: MutationObserver | null = null

    const setupIntersectionObserver = () => {
      if (!observerTargetRef.current)
        return

      disconnectObserver()

      // Create new observer
      observerRef.current = new IntersectionObserver(handleIntersection, {
        root: null,
        rootMargin: '100px',
        threshold: 0.1,
      })

      observerRef.current.observe(observerTargetRef.current)
    }

    // Set up MutationObserver to watch DOM changes
    mutationObserver = new MutationObserver((_mutations) => {
      if (observerTargetRef.current) {
        setupIntersectionObserver()
        mutationObserver?.disconnect()
      }
    })

    // Watch body changes since Portal adds content to body
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    })

    // If element exists, set up IntersectionObserver directly
    if (observerTargetRef.current)
      setupIntersectionObserver()

    return () => {
      resetLoadingState()
      disconnectObserver()
      mutationObserver?.disconnect()
    }
  }, [disconnectObserver, handleIntersection, isShow, resetLoadingState])

  const getAppType = (app: App) => {
    switch (app.mode) {
      case AppModeEnum.ADVANCED_CHAT:
        return 'chatflow'
      case AppModeEnum.AGENT_CHAT:
        return 'agent'
      case AppModeEnum.CHAT:
        return 'chat'
      case AppModeEnum.COMPLETION:
        return 'completion'
      case AppModeEnum.WORKFLOW:
        return 'workflow'
    }
  }

  const resolvedOffset = typeof offset === 'number' || typeof offset === 'function' ? undefined : offset
  const sideOffset = typeof offset === 'number' ? offset : resolvedOffset?.mainAxis ?? 0
  const alignOffset = typeof offset === 'number' ? 0 : resolvedOffset?.crossAxis ?? resolvedOffset?.alignmentAxis ?? 0
  const handleTriggerClick = useCallback((event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault()
    if (disabled || isShow)
      return

    onShowChange(true)
  }, [disabled, isShow, onShowChange])

  return (
    <Popover
      open={isShow}
      onOpenChange={onShowChange}
    >
      <PopoverTrigger
        render={<div>{trigger}</div>}
        onClick={handleTriggerClick}
      />

      <PopoverContent
        placement={placement}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        popupClassName="border-0 bg-transparent p-0 shadow-none backdrop-blur-none"
      >
        <div className="relative flex max-h-[400px] min-h-20 w-[356px] flex-col rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-xs">
          <div className="p-2 pb-1">
            <Input
              showLeftIcon
              showClearIcon
              value={searchText}
              onChange={e => onSearchChange(e.target.value)}
              onClear={() => onSearchChange('')}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-1">
            {apps.map(app => (
              <div
                key={app.id}
                className="flex cursor-pointer items-center gap-3 rounded-lg py-1 pr-3 pl-2 hover:bg-state-base-hover"
                onClick={() => onSelect(app)}
              >
                <AppIcon
                  className="shrink-0"
                  size="xs"
                  iconType={app.icon_type}
                  icon={app.icon}
                  background={app.icon_background}
                  imageUrl={app.icon_url}
                />
                <div title={`${app.name} (${app.id})`} className="grow system-sm-medium text-components-input-text-filled">
                  <span className="mr-1">{app.name}</span>
                  <span className="text-text-tertiary">
                    (
                    {app.id.slice(0, 8)}
                    )
                  </span>
                </div>
                <div className="shrink-0 system-2xs-medium-uppercase text-text-tertiary">{getAppType(app)}</div>
              </div>
            ))}
            <div ref={observerTargetRef} className="h-4 w-full">
              {isLoading && (
                <div className="flex justify-center py-2">
                  <div className="text-sm text-gray-500">{t('loading', { ns: 'common' })}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default React.memo(AppPicker)
