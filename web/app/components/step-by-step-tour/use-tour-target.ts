'use client'

import { useEffect, useState } from 'react'
import { getStepByStepTourTargetSelector } from './target-registry'

export const useStepByStepTourTarget = (target?: string) => {
  const [targetElement, setTargetElement] = useState<HTMLElement | null>(() => {
    if (!target || typeof document === 'undefined') return null

    return document.querySelector<HTMLElement>(getStepByStepTourTargetSelector(target))
  })

  useEffect(() => {
    if (typeof document === 'undefined') return

    const selector = target ? getStepByStepTourTargetSelector(target) : undefined

    if (!selector) {
      const animationFrame = window.requestAnimationFrame(() => setTargetElement(null))
      return () => window.cancelAnimationFrame(animationFrame)
    }

    let animationFrame = 0

    const syncTarget = () => {
      animationFrame = 0
      const nextTargetElement = document.querySelector<HTMLElement>(selector)
      setTargetElement((currentTargetElement) =>
        currentTargetElement === nextTargetElement ? currentTargetElement : nextTargetElement,
      )
    }

    const scheduleSyncTarget = () => {
      if (animationFrame) return

      animationFrame = window.requestAnimationFrame(syncTarget)
    }

    scheduleSyncTarget()

    const observer = new MutationObserver(scheduleSyncTarget)
    observer.observe(document.body, {
      attributeFilter: ['data-step-by-step-tour-target'],
      attributes: true,
      childList: true,
      subtree: true,
    })

    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame)
      observer.disconnect()
    }
  }, [target])

  return targetElement
}
