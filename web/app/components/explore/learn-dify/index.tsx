'use client'

import type { App } from '@/models/explore'
import type { TryAppSelection } from '@/types/try-app'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLearnDifyAppList } from '@/service/use-explore'
import { useLearnDifyVisibleValue, useSetLearnDifyHidden } from './atoms'
import LearnDifyItem from './item'

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
      if (hideTimerRef.current)
        clearTimeout(hideTimerRef.current)
    }
  }, [])

  const handleHide = () => {
    const sectionRect = sectionRef.current?.getBoundingClientRect()
    const helpTargetRect = document.querySelector('[data-learn-dify-help-target]')?.getBoundingClientRect()
    if (sectionRect && helpTargetRect) {
      const sectionCenterX = sectionRect.left + sectionRect.width / 2
      const sectionCenterY = sectionRect.top + sectionRect.height / 2
      const helpCenterX = helpTargetRect.left + helpTargetRect.width / 2
      const helpCenterY = helpTargetRect.top + helpTargetRect.height / 2

      setCollapseTransform(`translate3d(${helpCenterX - sectionCenterX}px, ${helpCenterY - sectionCenterY}px, 0) scale(0.08)`)
    }
    else {
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

  if (isLoading)
    return loadingFallback
  if (visibleItems.length === 0)
    return null

  return (
    <section
      ref={sectionRef}
      className={cn(
        'px-12 pb-6 transition-[opacity,transform] duration-800 ease-in-out',
        isClosing && 'pointer-events-none relative z-50 opacity-20',
        className,
      )}
      style={isClosing ? { transform: collapseTransform, transformOrigin: 'center center' } : undefined}
      aria-labelledby="learn-dify-title"
    >
      <div className="flex min-h-12 items-end justify-between gap-4 pb-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-4">
            <h2 id="learn-dify-title" className="min-w-0 truncate system-xl-semibold text-text-primary">
              {title ?? t('learnDify.title', { ns: 'explore' })}
            </h2>
            {onHide && (
              <button type="button" className="shrink-0 system-sm-medium text-text-primary" onClick={handleHide}>
                {t('learnDify.hide', { ns: 'explore' })}
              </button>
            )}
          </div>
          {showDescription && (
            <div className="mt-1 flex items-center justify-between gap-4">
              <p className="min-w-0 truncate system-xs-regular text-text-tertiary">
                {t('learnDify.description', { ns: 'explore' })}
              </p>
            </div>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {visibleItems.map(item => (
          <LearnDifyItem
            key={item.app_id}
            canCreate={canCreate}
            item={item}
            onCreate={onCreate}
            onTry={onTry}
          />
        ))}
      </div>
    </section>
  )
}

const DismissibleLearnDify = (props: LearnDifyProps) => {
  const visible = useLearnDifyVisibleValue()
  const setHidden = useSetLearnDifyHidden()

  if (!visible)
    return null

  return <LearnDifyContent {...props} onHide={() => setHidden(true)} />
}

const LearnDify = (props: LearnDifyProps) => {
  if (props.dismissible === false)
    return <LearnDifyContent {...props} />

  return <DismissibleLearnDify {...props} />
}

export default React.memo(LearnDify)
