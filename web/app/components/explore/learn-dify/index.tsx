'use client'

import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Link from '@/next/link'
import { learnDifyItems } from './data'
import LearnDifyItem from './item'
import { useLearnDifyHiddenState } from './storage'

type LearnDifyProps = {
  className?: string
}

const LearnDify = ({
  className,
}: LearnDifyProps) => {
  const { t } = useTranslation()
  const [hidden, setHidden] = useLearnDifyHiddenState()
  const [isClosing, setIsClosing] = useState(false)
  const [collapseTransform, setCollapseTransform] = useState<string>()
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sectionRef = useRef<HTMLElement>(null)

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
      setHidden(true)
      setIsClosing(false)
      setCollapseTransform(undefined)
    }, 800)
  }

  if (hidden)
    return null

  return (
    <section
      ref={sectionRef}
      className={cn(
        'px-12 pb-6 transition-all duration-800 ease-in-out',
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
              {t('learnDify.title', { ns: 'explore' })}
            </h2>
            <button type="button" className="shrink-0 system-sm-medium text-text-primary" onClick={handleHide}>
              {t('learnDify.hide', { ns: 'explore' })}
            </button>
          </div>
          <div className="mt-1 flex items-center justify-between gap-4">
            <p className="min-w-0 truncate system-xs-regular text-text-tertiary">
              {t('learnDify.description', { ns: 'explore' })}
            </p>
            <Link href="/explore/apps" className="shrink-0 system-sm-medium text-text-accent">
              {t('learnDify.moreTemplates', { ns: 'explore' })}
            </Link>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {learnDifyItems.map(item => (
          <LearnDifyItem key={item.id} item={item} />
        ))}
      </div>
    </section>
  )
}

export default React.memo(LearnDify)
