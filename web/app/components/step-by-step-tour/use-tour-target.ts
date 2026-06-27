'use client'

import { useEffect, useState } from 'react'
import { getStepByStepTourTargetSelector } from './target-registry'

export const useStepByStepTourTarget = (target?: string) => {
  const [targetElement, setTargetElement] = useState<HTMLElement | null>(() => {
    if (!target || typeof document === 'undefined')
      return null

    return document.querySelector<HTMLElement>(getStepByStepTourTargetSelector(target))
  })

  useEffect(() => {
    if (typeof document === 'undefined')
      return

    const selector = target ? getStepByStepTourTargetSelector(target) : undefined

    const syncTarget = () => {
      setTargetElement(selector ? document.querySelector<HTMLElement>(selector) : null)
    }

    const animationFrame = window.requestAnimationFrame(syncTarget)
    const observer = new MutationObserver(syncTarget)
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    })

    return () => {
      window.cancelAnimationFrame(animationFrame)
      observer.disconnect()
    }
  }, [target])

  return targetElement
}
