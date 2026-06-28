'use client'

import { useLayoutEffect, useRef, useState } from 'react'

export type StepByStepTourTargetRect = {
  height: number
  left: number
  top: number
  width: number
}

export type StepByStepTourTargetRects = {
  anchorRect: StepByStepTourTargetRect
  highlightPartsReady: boolean
  highlightRect: StepByStepTourTargetRect
  rectSettled: boolean
  targetElement: HTMLElement
}

const EMPTY_HIGHLIGHT_PART_SELECTORS: string[] = []
const MAX_RECT_SETTLE_FRAMES = 8
const ATTRIBUTE_OBSERVER_OPTIONS: MutationObserverInit = {
  attributeFilter: [
    'class',
    'data-align',
    'data-ending-style',
    'data-side',
    'data-starting-style',
    'hidden',
    'style',
  ],
  attributes: true,
}

const rectFromDOMRect = (rect: DOMRect): StepByStepTourTargetRect => ({
  height: rect.height,
  left: rect.left,
  top: rect.top,
  width: rect.width,
})

const unionTargetRects = (rects: StepByStepTourTargetRect[]): StepByStepTourTargetRect => {
  const left = Math.min(...rects.map(rect => rect.left))
  const top = Math.min(...rects.map(rect => rect.top))
  const right = Math.max(...rects.map(rect => rect.left + rect.width))
  const bottom = Math.max(...rects.map(rect => rect.top + rect.height))

  return {
    height: bottom - top,
    left,
    top,
    width: right - left,
  }
}

const getElementsBySelectors = (selectors: string[]) =>
  selectors.flatMap(selector => Array.from(document.querySelectorAll<HTMLElement>(selector)))

const getVisibleElementRect = (element: HTMLElement) => {
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0)
    return null

  return rectFromDOMRect(rect)
}

const getHighlightPartRectState = (selectors: string[]) => {
  const rectsBySelector = selectors.map(selector => Array.from(document.querySelectorAll<HTMLElement>(selector))
    .map(getVisibleElementRect)
    .filter((rect): rect is StepByStepTourTargetRect => Boolean(rect)))

  return {
    ready: rectsBySelector.every(rects => rects.length > 0),
    rects: rectsBySelector.flat(),
  }
}

const getTargetRects = (
  targetElement: HTMLElement,
  highlightPartSelectors: string[] = [],
) => {
  const anchorRect = rectFromDOMRect(targetElement.getBoundingClientRect())
  const highlightPartRectState = getHighlightPartRectState(highlightPartSelectors)
  const rects = [
    anchorRect,
    ...highlightPartRectState.rects,
  ]

  return {
    anchorRect,
    highlightPartsReady: highlightPartRectState.ready,
    highlightRect: unionTargetRects(rects),
    targetElement,
  }
}

const getInitialTargetRects = (
  targetElement: HTMLElement,
  highlightPartSelectors: string[] = [],
): StepByStepTourTargetRects => ({
  ...getTargetRects(targetElement, highlightPartSelectors),
  rectSettled: highlightPartSelectors.length === 0,
})

const areTargetRectsEqual = (
  currentRect: StepByStepTourTargetRect,
  nextRect: StepByStepTourTargetRect,
) => {
  return currentRect.height === nextRect.height
    && currentRect.left === nextRect.left
    && currentRect.top === nextRect.top
    && currentRect.width === nextRect.width
}

const areTargetRectSetsEqual = (
  currentRects: StepByStepTourTargetRects,
  nextRects: StepByStepTourTargetRects,
) => {
  return areTargetRectsEqual(currentRects.anchorRect, nextRects.anchorRect)
    && currentRects.highlightPartsReady === nextRects.highlightPartsReady
    && areTargetRectsEqual(currentRects.highlightRect, nextRects.highlightRect)
    && currentRects.rectSettled === nextRects.rectSettled
    && currentRects.targetElement === nextRects.targetElement
}

const areMeasuredTargetRectSetsEqual = (
  currentRects: Omit<StepByStepTourTargetRects, 'rectSettled'>,
  nextRects: Omit<StepByStepTourTargetRects, 'rectSettled'>,
) => {
  return areTargetRectsEqual(currentRects.anchorRect, nextRects.anchorRect)
    && currentRects.highlightPartsReady === nextRects.highlightPartsReady
    && areTargetRectsEqual(currentRects.highlightRect, nextRects.highlightRect)
    && currentRects.targetElement === nextRects.targetElement
}

export const useStepByStepTourTargetRect = (
  targetElement: HTMLElement,
  highlightPartSelectors: string[] = EMPTY_HIGHLIGHT_PART_SELECTORS,
) => {
  const [targetRects, setTargetRects] = useState(() => getInitialTargetRects(targetElement, highlightPartSelectors))
  const targetRectsRef = useRef(targetRects)
  targetRectsRef.current = targetRects

  useLayoutEffect(() => {
    let animationFrame = 0
    let resizeObserver: ResizeObserver | undefined
    let mutationObserver: MutationObserver | undefined
    let previousMeasuredRects: Omit<StepByStepTourTargetRects, 'rectSettled'> | undefined
    let settleFrameCount = 0
    const observedResizeElements = new Set<HTMLElement>()
    const observedAttributeElements = new Set<HTMLElement>()

    function observeResizeElement(element: HTMLElement) {
      if (observedResizeElements.has(element))
        return

      observedResizeElements.add(element)
      resizeObserver?.observe(element)
    }

    function observeAttributeElement(element: HTMLElement) {
      if (!mutationObserver || observedAttributeElements.has(element))
        return

      observedAttributeElements.add(element)
      mutationObserver.observe(element, ATTRIBUTE_OBSERVER_OPTIONS)
    }

    function observeHighlightPart(element: HTMLElement) {
      // Floating UI positioners already run resize-driven layout internally.
      // Attribute and mount observers are enough to remeasure their stable rects.
      observeAttributeElement(element)
      if (element.parentElement)
        observeAttributeElement(element.parentElement)
    }

    function syncRect() {
      animationFrame = 0
      const highlightPartElements = getElementsBySelectors(highlightPartSelectors)
      highlightPartElements.forEach(observeHighlightPart)

      const nextMeasuredRects = getTargetRects(targetElement, highlightPartSelectors)
      if (highlightPartSelectors.length === 0) {
        previousMeasuredRects = nextMeasuredRects
        settleFrameCount = 0
        commitTargetRects({
          ...nextMeasuredRects,
          rectSettled: true,
        })
        return
      }

      if (!nextMeasuredRects.highlightPartsReady) {
        previousMeasuredRects = undefined
        settleFrameCount = 0
        commitTargetRects({
          ...nextMeasuredRects,
          rectSettled: false,
        })
        return
      }

      const rectSettled = Boolean(previousMeasuredRects)
        && areMeasuredTargetRectSetsEqual(previousMeasuredRects, nextMeasuredRects)
      const shouldCommitMeasuredRect = rectSettled || settleFrameCount >= MAX_RECT_SETTLE_FRAMES
      previousMeasuredRects = nextMeasuredRects
      if (shouldCommitMeasuredRect) {
        settleFrameCount = 0
        commitTargetRects({
          ...nextMeasuredRects,
          rectSettled: true,
        })
        return
      }

      settleFrameCount += 1
      const nextRects = {
        ...nextMeasuredRects,
        rectSettled: false,
      }
      commitTargetRects(nextRects)
      scheduleSyncRect()
    }

    function commitTargetRects(nextRects: StepByStepTourTargetRects) {
      if (areTargetRectSetsEqual(targetRectsRef.current, nextRects))
        return

      targetRectsRef.current = nextRects
      setTargetRects(nextRects)
    }

    function scheduleSyncRect() {
      if (animationFrame)
        return

      animationFrame = window.requestAnimationFrame(syncRect)
    }

    resizeObserver = typeof ResizeObserver === 'undefined'
      ? undefined
      : new ResizeObserver(scheduleSyncRect)
    observeResizeElement(targetElement)

    mutationObserver = typeof MutationObserver === 'undefined'
      ? undefined
      : new MutationObserver(scheduleSyncRect)
    mutationObserver?.observe(document.body, {
      childList: true,
      subtree: true,
    })
    observeAttributeElement(targetElement)

    window.addEventListener('resize', scheduleSyncRect)
    window.addEventListener('scroll', scheduleSyncRect, true)

    syncRect()

    return () => {
      if (animationFrame)
        window.cancelAnimationFrame(animationFrame)
      resizeObserver?.disconnect()
      mutationObserver?.disconnect()
      window.removeEventListener('resize', scheduleSyncRect)
      window.removeEventListener('scroll', scheduleSyncRect, true)
    }
  }, [highlightPartSelectors, targetElement])

  return targetRects
}
