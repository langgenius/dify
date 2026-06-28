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

export type StepByStepTourCoachmarkPlacement = 'bottom' | 'top'

const getViewportSize = (): ViewportSize => ({
  height: window.innerHeight,
  width: window.innerWidth,
})

const clamp = (value: number, min: number, max: number) => {
  return Math.min(Math.max(value, min), max)
}

export const getStepByStepTourCoachmarkPosition = (
  placementRect: StepByStepTourTargetRect,
  viewportSize: ViewportSize,
  placement: StepByStepTourCoachmarkPlacement = 'bottom',
  anchorRect: StepByStepTourTargetRect = placementRect,
): CoachmarkPosition => {
  const maxBubbleLeft = viewportSize.width - BUBBLE_WIDTH - VIEWPORT_PADDING
  const bubbleLeft = clamp(
    placementRect.left,
    VIEWPORT_PADDING,
    Math.max(VIEWPORT_PADDING, maxBubbleLeft),
  )
  const maxBubbleTop = viewportSize.height - BUBBLE_HEIGHT - VIEWPORT_PADDING
  const preferredBubbleTop = placement === 'top'
    ? placementRect.top - BUBBLE_HEIGHT - BUBBLE_SIDE_OFFSET
    : placementRect.top + placementRect.height + BUBBLE_SIDE_OFFSET
  const bubbleTop = clamp(
    preferredBubbleTop,
    VIEWPORT_PADDING,
    Math.max(VIEWPORT_PADDING, maxBubbleTop),
  )
  const targetAnchorX = anchorRect.left + FIGMA_ARROW_FRAME_LEFT + FIGMA_ARROW_DOT_CENTER_X
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

export const useStepByStepTourCoachmarkPosition = (
  placementRect: StepByStepTourTargetRect,
  placement: StepByStepTourCoachmarkPlacement = 'bottom',
  anchorRect: StepByStepTourTargetRect = placementRect,
) => {
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

  return getStepByStepTourCoachmarkPosition(placementRect, viewportSize, placement, anchorRect)
}
