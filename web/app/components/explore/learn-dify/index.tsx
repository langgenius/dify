'use client'

import type { App } from '@/models/explore'
import type { TryAppSelection } from '@/types/try-app'
import { cn } from '@langgenius/dify-ui/cn'
import { useSuspenseQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { useLearnDifyAppList } from '@/service/use-explore'
import LearnDifyItem from './item'
import { useLearnDifyHiddenValue, useSetLearnDifyHidden } from './storage'

type LearnDifyProps = {
  canCreate?: boolean
  className?: string
  dismissible?: boolean
  itemLimit?: number
  loadingFallback?: React.ReactNode
  onCreate?: (app: App) => void
  onTry?: (params: TryAppSelection) => void
  showDescription?: boolean
  title?: string
}

type LearnDifyContentProps = LearnDifyProps & {
  onHide?: () => void
}

const LearnDifyContent = ({
  canCreate = false,
  className,
  itemLimit,
  loadingFallback = null,
  onHide,
  onCreate,
  onTry,
  showDescription = true,
  title,
}: LearnDifyContentProps) => {
  const { t } = useTranslation()
  const [isClosing, setIsClosing] = useState(false)
  const [collapseTransform, setCollapseTransform] = useState<string>()
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sectionRef = useRef<HTMLElement>(null)
  const { data: learnDifyItems = [], isLoading } = useLearnDifyAppList()

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    }
  }, [])

  const handleHide = () => {
    const sectionRect = sectionRef.current?.getBoundingClientRect()
    const helpTargetRect = document
      .querySelector('[data-learn-dify-help-target]')
      ?.getBoundingClientRect()
    if (sectionRect && helpTargetRect) {
      const sectionCenterX = sectionRect.left + sectionRect.width / 2
      const sectionCenterY = sectionRect.top + sectionRect.height / 2
      const helpCenterX = helpTargetRect.left + helpTargetRect.width / 2
      const helpCenterY = helpTargetRect.top + helpTargetRect.height / 2

      setCollapseTransform(
        `translate3d(${helpCenterX - sectionCenterX}px, ${helpCenterY - sectionCenterY}px, 0) scale(0.08)`,
      )
    } else {
      setCollapseTransform('scale(0.08)')
    }
    setIsClosing(true)
    hideTimerRef.current = setTimeout(() => {
      onHide?.()
      setIsClosing(false)
      setCollapseTransform(undefined)
    }, 800)
  }

  const visibleItems = itemLimit ? learnDifyItems.slice(0, itemLimit) : learnDifyItems
  const sectionTitle = title ?? t(($) => $['learnDify.title'], { ns: 'explore' })

  if (isLoading) return loadingFallback
  if (visibleItems.length === 0) return null

  return (
    <section
      ref={sectionRef}
      className={cn(
        'px-8 pb-6 transition-[opacity,transform] duration-800 ease-in-out',
        isClosing && 'pointer-events-none relative z-50 opacity-20',
        className,
      )}
      style={
        isClosing ? { transform: collapseTransform, transformOrigin: 'center center' } : undefined
      }
      aria-labelledby="learn-dify-title"
    >
      <div className="-mx-4 rounded-2xl bg-background-section p-4">
        <div className="flex items-start justify-between gap-4 pb-2.5">
          <div className="min-w-0">
            <h2
              id="learn-dify-title"
              className="truncate system-xl-medium text-text-primary"
              title={sectionTitle}
            >
              {sectionTitle}
            </h2>
            {showDescription && (
              <p className="mt-0.5 truncate system-xs-regular text-text-tertiary">
                {t(($) => $['learnDify.description'], { ns: 'explore' })}
              </p>
            )}
          </div>
          {onHide && (
            <button
              type="button"
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:bg-state-base-hover focus-visible:ring-1 focus-visible:ring-components-input-border-hover focus-visible:outline-hidden"
              aria-label={t(($) => $['learnDify.hide'], { ns: 'explore' })}
              onClick={handleHide}
            >
              <span className="i-ri-close-line size-4" aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(296px,1fr))] gap-2.5">
          {visibleItems.map((item) => (
            <LearnDifyItem
              key={item.app_id}
              canCreate={canCreate}
              item={item}
              onCreate={onCreate}
              onTry={onTry}
            />
          ))}
        </div>
      </div>
    </section>
  )
}

const DismissibleLearnDify = (props: LearnDifyProps) => {
  const hidden = useLearnDifyHiddenValue()
  const setHidden = useSetLearnDifyHidden()

  if (hidden) return null

  return <LearnDifyContent {...props} onHide={() => setHidden(true)} />
}

const LearnDify = (props: LearnDifyProps) => {
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())

  if (!systemFeatures.enable_learn_app) return null

  if (props.dismissible === false) return <LearnDifyContent {...props} />

  return <DismissibleLearnDify {...props} />
}

export default React.memo(LearnDify)
