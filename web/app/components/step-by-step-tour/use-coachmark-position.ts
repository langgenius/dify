'use client'

import type { CSSProperties } from 'react'
import type { StepByStepTourTargetRect } from './use-target-rect'
import { useLayoutEffect, useState } from 'react'

const BUBBLE_WIDTH = 352
const BUBBLE_HEIGHT = 158
const BUBBLE_SIDE_OFFSET = 20
const VIEWPORT_PADDING = 8
const FIGMA_ARROW_FRAME_LEFT = 28
const FIGMA_ARROW_DOT_CENTER_X = 1
const MIN_ARROW_LEFT = 12
const MAX_ARROW_RIGHT_PADDING = 12

type ViewportSize = {
  height: number
  width: number
}

type CoachmarkPosition = {
  arrowStyle: CSSProperties
  bubbleStyle: CSSProperties
}

const getViewportSize = (): ViewportSize => ({
  height: window.innerHeight,
  width: window.innerWidth,
})

const clamp = (value: number, min: number, max: number) => {
  return Math.min(Math.max(value, min), max)
}

export const getStepByStepTourCoachmarkPosition = (
  targetRect: StepByStepTourTargetRect,
  viewportSize: ViewportSize,
): CoachmarkPosition => {
  const maxBubbleLeft = viewportSize.width - BUBBLE_WIDTH - VIEWPORT_PADDING
  const bubbleLeft = clamp(
    targetRect.left,
    VIEWPORT_PADDING,
    Math.max(VIEWPORT_PADDING, maxBubbleLeft),
  )
  const maxBubbleTop = viewportSize.height - BUBBLE_HEIGHT - VIEWPORT_PADDING
  const bubbleTop = clamp(
    targetRect.top + targetRect.height + BUBBLE_SIDE_OFFSET,
    VIEWPORT_PADDING,
    Math.max(VIEWPORT_PADDING, maxBubbleTop),
  )
  const targetAnchorX = targetRect.left + FIGMA_ARROW_FRAME_LEFT + FIGMA_ARROW_DOT_CENTER_X
  const arrowLeft = clamp(
    targetAnchorX - bubbleLeft - FIGMA_ARROW_DOT_CENTER_X,
    MIN_ARROW_LEFT,
    BUBBLE_WIDTH - MAX_ARROW_RIGHT_PADDING,
  )

  return {
    arrowStyle: {
      left: arrowLeft,
    },
    bubbleStyle: {
      left: bubbleLeft,
      top: bubbleTop,
    },
  }
}

export const useStepByStepTourCoachmarkPosition = (targetRect: StepByStepTourTargetRect) => {
  const [viewportSize, setViewportSize] = useState<ViewportSize>(() => getViewportSize())

  useLayoutEffect(() => {
    const syncViewportSize = () => {
      setViewportSize(getViewportSize())
    }

    window.addEventListener('resize', syncViewportSize)

    return () => {
      window.removeEventListener('resize', syncViewportSize)
    }
  }, [])

  return getStepByStepTourCoachmarkPosition(targetRect, viewportSize)
}
