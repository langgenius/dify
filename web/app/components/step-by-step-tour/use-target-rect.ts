'use client'

import { useLayoutEffect, useRef, useState } from 'react'

export type StepByStepTourTargetRect = {
  height: number
  left: number
  top: number
  width: number
}

const getTargetRect = (targetElement: HTMLElement): StepByStepTourTargetRect => {
  const rect = targetElement.getBoundingClientRect()

  return {
    height: rect.height,
    left: rect.left,
    top: rect.top,
    width: rect.width,
  }
}

const areTargetRectsEqual = (
  currentRect: StepByStepTourTargetRect,
  nextRect: StepByStepTourTargetRect,
) => {
  return currentRect.height === nextRect.height
    && currentRect.left === nextRect.left
    && currentRect.top === nextRect.top
    && currentRect.width === nextRect.width
}

export const useStepByStepTourTargetRect = (targetElement: HTMLElement) => {
  const [targetRect, setTargetRect] = useState(() => getTargetRect(targetElement))
  const targetRectRef = useRef(targetRect)
  targetRectRef.current = targetRect

  useLayoutEffect(() => {
    let animationFrame = 0

    const syncRect = () => {
      const nextRect = getTargetRect(targetElement)
      if (!areTargetRectsEqual(targetRectRef.current, nextRect)) {
        targetRectRef.current = nextRect
        setTargetRect(nextRect)
      }
      animationFrame = window.requestAnimationFrame(syncRect)
    }

    animationFrame = window.requestAnimationFrame(syncRect)

    return () => {
      window.cancelAnimationFrame(animationFrame)
    }
  }, [targetElement])

  return targetRect
}
