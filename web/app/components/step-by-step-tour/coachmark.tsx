'use client'

import type { CSSProperties } from 'react'
import type { StepByStepTourGuide, StepByStepTourGuideInteractionPolicy } from './target-registry'
import type { StepByStepTourCoachmarkPlacement, StepByStepTourCoachmarkSize } from './use-coachmark-position'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { getStepByStepTourGuideKind, getStepByStepTourTargetSelector } from './target-registry'
import { useStepByStepTourCoachmarkPosition } from './use-coachmark-position'
import { useStepByStepTourTargetRect } from './use-target-rect'

const HIGHLIGHT_PADDING = 4
const DEFAULT_COACHMARK_SIZE: StepByStepTourCoachmarkSize = {
  height: 158,
  width: 352,
}
const VERTICAL_ARROW_LENGTH = 28
const VERTICAL_ARROW_DOT_SIZE = 12
const VERTICAL_ARROW_DOT_OVERHANG = 3
const VERTICAL_ARROW_OPTICAL_OFFSET = 1
const VERTICAL_ARROW_EDGE_OFFSET = VERTICAL_ARROW_LENGTH - VERTICAL_ARROW_DOT_SIZE / 2 - HIGHLIGHT_PADDING + VERTICAL_ARROW_OPTICAL_OFFSET

const VERTICAL_ARROW_DOT_STYLE: CSSProperties = {
  top: -VERTICAL_ARROW_DOT_OVERHANG,
}

const getStepByStepTourVerticalArrowStyle = (
  placement: StepByStepTourCoachmarkPlacement,
  arrowStyle: CSSProperties,
): CSSProperties => ({
  ...arrowStyle,
  ...(placement === 'top'
    ? { bottom: -VERTICAL_ARROW_EDGE_OFFSET }
    : { top: -VERTICAL_ARROW_EDGE_OFFSET }),
})

type StepByStepTourCoachmarkGuide = Omit<StepByStepTourGuide, 'description' | 'learnMoreLabel' | 'primaryActionLabel' | 'title'> & {
  description: string
  learnMoreHref?: string
  learnMoreLabel: string
  primaryActionLabel: string
  title: string
}

type StepByStepTourCoachmarkProps = {
  guide: StepByStepTourCoachmarkGuide
  targetElement: HTMLElement
  placement?: StepByStepTourCoachmarkPlacement
  stepLabel: string
  skipLabel: string
  interactionPolicy: StepByStepTourGuideInteractionPolicy
  onSkip: () => void
  onComplete: () => void
}

export function StepByStepTourCoachmark({
  guide,
  targetElement,
  placement = 'bottom',
  stepLabel,
  skipLabel,
  interactionPolicy,
  onSkip,
  onComplete,
}: StepByStepTourCoachmarkProps) {
  const { anchorRect, highlightPartsReady, highlightRect, rectSettled, targetElement: measuredTargetElement } = useStepByStepTourTargetRect(targetElement, guide.highlightPartSelectors)
  const coachmarkRef = useRef<HTMLDivElement>(null)
  const coachmarkSizeFrameRef = useRef<number | undefined>(undefined)
  const [coachmarkSize, setCoachmarkSize] = useState<StepByStepTourCoachmarkSize>(DEFAULT_COACHMARK_SIZE)
  const coachmarkPosition = useStepByStepTourCoachmarkPosition(highlightRect, placement, anchorRect, coachmarkSize)
  const stableOverlayRef = useRef<{
    coachmarkPosition: ReturnType<typeof useStepByStepTourCoachmarkPosition>
    guide: StepByStepTourCoachmarkGuide
    highlightRect: typeof highlightRect
    onComplete: () => void
    onSkip: () => void
    placement: StepByStepTourCoachmarkPlacement
    skipLabel: string
    interactionPolicy: StepByStepTourGuideInteractionPolicy
    stepLabel: string
  } | undefined>(undefined)

  const measuredRectMatchesGuide = measuredTargetElement === targetElement
    && targetElement.matches(getStepByStepTourTargetSelector(guide.target))

  if (highlightPartsReady && rectSettled && measuredRectMatchesGuide) {
    stableOverlayRef.current = {
      coachmarkPosition,
      guide,
      highlightRect,
      onComplete,
      onSkip,
      placement: coachmarkPosition.placement,
      skipLabel,
      interactionPolicy,
      stepLabel,
    }
  }

  const stableOverlay = stableOverlayRef.current
  const isActionGuide = stableOverlay ? getStepByStepTourGuideKind(stableOverlay.guide) === 'action' : false
  const coachmarkMeasurementKey = stableOverlay
    ? [
        stableOverlay.guide.target,
        stableOverlay.guide.title,
        stableOverlay.guide.description,
        stableOverlay.guide.learnMoreHref,
        stableOverlay.guide.learnMoreLabel,
        stableOverlay.guide.primaryActionLabel,
        stableOverlay.placement,
        stableOverlay.stepLabel,
        stableOverlay.skipLabel,
        isActionGuide,
      ].join('|')
    : undefined
  const highlightStyle: CSSProperties | undefined = stableOverlay
    ? {
        height: stableOverlay.highlightRect.height + HIGHLIGHT_PADDING * 2,
        left: stableOverlay.highlightRect.left - HIGHLIGHT_PADDING,
        top: stableOverlay.highlightRect.top - HIGHLIGHT_PADDING,
        width: stableOverlay.highlightRect.width + HIGHLIGHT_PADDING * 2,
      }
    : undefined

  const syncCoachmarkSize = useCallback((element: HTMLElement) => {
    const rect = element.getBoundingClientRect()
    const nextSize = {
      height: Math.ceil(rect.height),
      width: Math.ceil(rect.width),
    }
    if (nextSize.height <= 0 || nextSize.width <= 0)
      return

    setCoachmarkSize(currentSize => (
      currentSize.height === nextSize.height && currentSize.width === nextSize.width
        ? currentSize
        : nextSize
    ))
  }, [])

  useLayoutEffect(() => {
    const element = coachmarkRef.current
    if (!element)
      return

    coachmarkSizeFrameRef.current = window.requestAnimationFrame(() => {
      coachmarkSizeFrameRef.current = undefined
      syncCoachmarkSize(element)
    })

    return () => {
      if (coachmarkSizeFrameRef.current !== undefined) {
        window.cancelAnimationFrame(coachmarkSizeFrameRef.current)
        coachmarkSizeFrameRef.current = undefined
      }
    }
  }, [coachmarkMeasurementKey, syncCoachmarkSize])

  if (typeof document === 'undefined')
    return null

  const targetBlockerStyles: CSSProperties[] = stableOverlay && highlightStyle
    ? [
        {
          height: highlightStyle.top,
          left: 0,
          right: 0,
          top: 0,
        },
        {
          bottom: 0,
          left: 0,
          top: Number(highlightStyle.top) + Number(highlightStyle.height),
          right: 0,
        },
        {
          height: highlightStyle.height,
          left: 0,
          top: highlightStyle.top,
          width: highlightStyle.left,
        },
        {
          height: highlightStyle.height,
          left: Number(highlightStyle.left) + Number(highlightStyle.width),
          right: 0,
          top: highlightStyle.top,
        },
      ]
    : []

  return createPortal(
    <>
      {stableOverlay?.interactionPolicy === 'target-only'
        ? targetBlockerStyles.map((style, index) => (
            <div
              // eslint-disable-next-line react/no-array-index-key -- The four blocker slices are static and positional.
              key={index}
              aria-hidden="true"
              data-step-by-step-tour-backdrop=""
              data-step-by-step-tour-blocker=""
              className="fixed z-50 cursor-default bg-transparent"
              style={style}
            />
          ))
        : (
            <div
              aria-hidden="true"
              data-step-by-step-tour-backdrop=""
              className="fixed inset-0 z-50 cursor-default bg-transparent"
            />
          )}
      {stableOverlay && highlightStyle && (
        <>
          <div
            aria-hidden="true"
            data-step-by-step-tour-highlight=""
            className="pointer-events-none fixed z-50 rounded-xl shadow-[0_0_0_9999px_rgb(15_23_42/0.58)]"
            style={highlightStyle}
          />
          <div
            ref={coachmarkRef}
            className="fixed z-50 w-[352px] max-w-[calc(100vw-16px)]"
            data-step-by-step-tour-coachmark=""
            style={stableOverlay.coachmarkPosition.bubbleStyle}
          >
            {stableOverlay.placement === 'right'
              ? (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute -left-1.5 size-3 rotate-45 border-b-[0.5px] border-l-[0.5px] border-state-accent-hover-alt bg-state-accent-hover"
                    style={stableOverlay.coachmarkPosition.arrowStyle}
                  />
                )
              : (
                  <div
                    className={cn(
                      'pointer-events-none absolute h-7 w-0.5',
                      stableOverlay.placement === 'top' && 'rotate-180',
                    )}
                    style={getStepByStepTourVerticalArrowStyle(stableOverlay.placement, stableOverlay.coachmarkPosition.arrowStyle)}
                    aria-hidden="true"
                  >
                    <span className="absolute top-0 left-1/2 h-7 w-0.5 -translate-x-1/2 bg-state-accent-hover-alt shadow-[0_20px_24px_-4px_var(--color-shadow-shadow-5),0_8px_8px_-4px_var(--color-shadow-shadow-1)]" />
                    <span style={VERTICAL_ARROW_DOT_STYLE} className="absolute left-1/2 size-3 -translate-x-1/2 rounded-full border-2 border-state-accent-hover bg-state-accent-solid shadow-xs" />
                  </div>
                )}
            <section
              aria-label={isActionGuide ? stableOverlay.guide.description : stableOverlay.guide.title}
              className={cn(
                'relative flex w-full flex-col rounded-2xl border-[0.5px] border-state-accent-hover-alt bg-state-accent-hover p-4 shadow-[0_20px_24px_-4px_var(--color-shadow-shadow-5),0_8px_8px_-4px_var(--color-shadow-shadow-1)] backdrop-blur-[5px]',
                !isActionGuide && 'min-h-[158px]',
              )}
            >
              {isActionGuide
                ? (
                    <p className="system-md-medium text-text-primary">{stableOverlay.guide.description}</p>
                  )
                : (
                    <>
                      <div className="pb-0.5 system-2xs-semibold-uppercase text-text-tertiary">{stableOverlay.stepLabel}</div>
                      <h2 className="mt-1 system-md-medium text-text-primary">{stableOverlay.guide.title}</h2>
                      <p className="mt-1 system-xs-regular text-text-secondary">{stableOverlay.guide.description}</p>
                      <div className="mt-auto flex h-12 items-center justify-between gap-3 pt-4">
                        <button
                          type="button"
                          className="shrink-0 cursor-pointer rounded-md border-none bg-transparent p-0 text-left system-sm-regular text-text-tertiary outline-hidden hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                          onClick={stableOverlay.onSkip}
                        >
                          {stableOverlay.skipLabel}
                        </button>
                        <div className="flex shrink-0 items-center gap-1">
                          {stableOverlay.guide.learnMoreHref && (
                            <a
                              href={stableOverlay.guide.learnMoreHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-lg px-3 system-sm-medium text-text-tertiary outline-hidden hover:bg-components-button-ghost-bg-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                            >
                              {stableOverlay.guide.learnMoreLabel}
                              <span aria-hidden className="i-ri-arrow-right-up-line size-4" />
                            </a>
                          )}
                          <Button variant="primary" size="medium" className="min-w-20 px-3" onClick={stableOverlay.onComplete}>
                            {stableOverlay.guide.primaryActionLabel}
                          </Button>
                        </div>
                      </div>
                    </>
                  )}
            </section>
          </div>
        </>
      )}
    </>,
    document.body,
  )
}
