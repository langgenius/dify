'use client'

import type { CSSProperties } from 'react'
import type { StepByStepTourGuide, StepByStepTourGuideInteractionPolicy } from './target-registry'
import type { StepByStepTourCoachmarkPlacement } from './use-coachmark-position'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { getStepByStepTourGuideKind, getStepByStepTourTargetSelector } from './target-registry'
import { useStepByStepTourCoachmarkPosition } from './use-coachmark-position'
import { useStepByStepTourTargetRect } from './use-target-rect'

const HIGHLIGHT_PADDING = 4

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
  const coachmarkPosition = useStepByStepTourCoachmarkPosition(highlightRect, placement, anchorRect)
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
      placement,
      skipLabel,
      interactionPolicy,
      stepLabel,
    }
  }

  const stableOverlay = stableOverlayRef.current
  const isActionGuide = stableOverlay ? getStepByStepTourGuideKind(stableOverlay.guide) === 'action' : false
  const highlightStyle: CSSProperties | undefined = stableOverlay
    ? {
        height: stableOverlay.highlightRect.height + HIGHLIGHT_PADDING * 2,
        left: stableOverlay.highlightRect.left - HIGHLIGHT_PADDING,
        top: stableOverlay.highlightRect.top - HIGHLIGHT_PADDING,
        width: stableOverlay.highlightRect.width + HIGHLIGHT_PADDING * 2,
      }
    : undefined

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
            className="fixed z-50 w-[352px] max-w-[calc(100vw-16px)]"
            data-step-by-step-tour-coachmark=""
            style={stableOverlay.coachmarkPosition.bubbleStyle}
          >
            {stableOverlay.placement === 'right'
              ? (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute -left-1.5 size-3 rotate-45 border-b-[0.5px] border-l-[0.5px] border-state-base-hover-alt bg-[#e9f0ff]"
                    style={stableOverlay.coachmarkPosition.arrowStyle}
                  />
                )
              : (
                  <div
                    className={cn(
                      'pointer-events-none absolute h-7 w-0.5',
                      stableOverlay.placement === 'top' ? '-bottom-6 rotate-180' : '-top-6',
                    )}
                    style={stableOverlay.coachmarkPosition.arrowStyle}
                    aria-hidden="true"
                  >
                    <span className="absolute -top-[7.5px] -left-[25px] i-custom-public-step-by-step-tour-coachmark-arrow h-[75.5px] w-[52px]" />
                  </div>
                )}
            <section
              aria-label={isActionGuide ? stableOverlay.guide.description : stableOverlay.guide.title}
              className={cn(
                'relative flex w-full flex-col rounded-2xl border-[0.5px] border-state-base-hover-alt bg-[#e9f0ff] p-4 shadow-[0_20px_24px_-4px_var(--color-shadow-shadow-5),0_8px_8px_-4px_var(--color-shadow-shadow-1)] backdrop-blur-[5px]',
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
