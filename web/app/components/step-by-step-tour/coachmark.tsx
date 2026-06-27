'use client'

import type { CSSProperties } from 'react'
import type { StepByStepTourGuide } from './target-registry'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useStepByStepTourCoachmarkPosition } from './use-coachmark-position'
import { useStepByStepTourTargetRect } from './use-target-rect'

type StepByStepTourCoachmarkProps = {
  guide: StepByStepTourGuide
  targetElement: HTMLElement
  stepLabel: string
  skipLabel: string
  learnMoreHref?: string
  onSkip: () => void
  onComplete: () => void
}

export function StepByStepTourCoachmark({
  guide,
  targetElement,
  stepLabel,
  skipLabel,
  learnMoreHref,
  onSkip,
  onComplete,
}: StepByStepTourCoachmarkProps) {
  const targetRect = useStepByStepTourTargetRect(targetElement)
  const coachmarkPosition = useStepByStepTourCoachmarkPosition(targetRect)

  const highlightStyle: CSSProperties = {
    height: targetRect.height,
    left: targetRect.left,
    top: targetRect.top,
    width: targetRect.width,
  }

  return (
    <>
      <div
        aria-hidden="true"
        data-step-by-step-tour-backdrop=""
        className="fixed inset-0 z-50 cursor-default bg-transparent"
      />
      <div
        aria-hidden="true"
        data-step-by-step-tour-highlight=""
        className="pointer-events-none fixed z-50 rounded-xl shadow-[0_0_0_9999px_rgb(15_23_42/0.58)]"
        style={highlightStyle}
      />
      <div
        className="fixed z-50 w-[352px] max-w-[calc(100vw-16px)]"
        data-step-by-step-tour-coachmark=""
        style={coachmarkPosition.bubbleStyle}
      >
        <div className="pointer-events-none absolute -top-6 h-7 w-0.5" style={coachmarkPosition.arrowStyle} aria-hidden="true">
          <span className="absolute -top-[7.5px] -left-[25px] i-custom-public-step-by-step-tour-coachmark-arrow h-[75.5px] w-[52px]" />
        </div>
        <section
          aria-label={guide.title}
          className={cn(
            'relative flex min-h-[158px] w-full flex-col rounded-2xl border-[0.5px] border-state-base-hover-alt bg-[#e9f0ff] p-4 shadow-[0_20px_24px_-4px_var(--color-shadow-shadow-5),0_8px_8px_-4px_var(--color-shadow-shadow-1)] backdrop-blur-[5px]',
          )}
        >
          <div className="pb-0.5 system-2xs-semibold-uppercase text-text-tertiary">{stepLabel}</div>
          <h2 className="mt-1 system-md-medium text-text-primary">{guide.title}</h2>
          <p className="mt-1 system-xs-regular text-text-secondary">{guide.description}</p>
          <div className="mt-auto flex h-12 items-center justify-between gap-3 pt-4">
            <Button variant="ghost" size="medium" className="px-0 text-text-tertiary hover:bg-transparent hover:text-text-secondary" onClick={onSkip}>
              {skipLabel}
            </Button>
            <div className="flex shrink-0 items-center gap-1">
              {learnMoreHref && (
                <a
                  href={learnMoreHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-8 w-[117px] items-center justify-center gap-1 rounded-lg px-2 system-sm-medium text-text-tertiary outline-hidden hover:bg-components-button-ghost-bg-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                >
                  {guide.learnMoreLabel}
                  <span aria-hidden className="i-ri-arrow-right-up-line size-4" />
                </a>
              )}
              <Button variant="primary" size="medium" className="w-20" onClick={onComplete}>
                {guide.primaryActionLabel}
              </Button>
            </div>
          </div>
        </section>
      </div>
    </>
  )
}
