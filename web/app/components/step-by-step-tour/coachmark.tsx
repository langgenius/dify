'use client'

import type { PopoverChangeEventDetails } from '@langgenius/dify-ui/popover'
import type { StepByStepTourGuide, StepByStepTourGuideInteractionPolicy } from './target-registry'
import type { CoachmarkSide } from '@/app/components/base/coachmark'
import { Button, buttonVariants } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useRef } from 'react'
import {
  Coachmark,
  CoachmarkArrow,
  CoachmarkClose,
  CoachmarkDescription,
  CoachmarkPopup,
  CoachmarkPortal,
  CoachmarkPositioner,
  CoachmarkSpotlight,
  CoachmarkTitle,
} from '@/app/components/base/coachmark'
import { getStepByStepTourGuideKind, getStepByStepTourTargetSelector } from './target-registry'

type StepByStepTourCoachmarkGuide = Omit<
  StepByStepTourGuide,
  'description' | 'learnMoreLabel' | 'primaryActionLabel' | 'title'
> & {
  description: string
  learnMoreHref?: string
  learnMoreLabel: string
  primaryActionLabel: string
  title: string
}

type StepByStepTourCoachmarkProps = {
  guide: StepByStepTourCoachmarkGuide
  targetElement: HTMLElement | null
  placement?: Extract<CoachmarkSide, 'bottom' | 'inline-end' | 'top'>
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
  const primaryActionRef = useRef<HTMLButtonElement>(null)

  const handleOpenChange = (nextOpen: boolean, eventDetails: PopoverChangeEventDetails) => {
    if (
      !nextOpen &&
      (eventDetails.reason === 'escape-key' || eventDetails.reason === 'close-press')
    )
      onSkip()
  }

  return (
    <Coachmark
      target={targetElement}
      targetPending={!targetElement?.matches(getStepByStepTourTargetSelector(guide.target))}
      highlightSelectors={guide.highlightPartSelectors}
      step={guide.id}
      payload={{ guide, placement, skipLabel, stepLabel }}
      interaction={interactionPolicy}
      onOpenChange={handleOpenChange}
    >
      {({ payload, stale }) => {
        const isActionGuide = getStepByStepTourGuideKind(payload.guide) === 'action'

        return (
          <CoachmarkPortal>
            <CoachmarkSpotlight data-step-by-step-tour-highlight="" />
            <CoachmarkPositioner side={payload.placement}>
              <CoachmarkPopup
                initialFocus={primaryActionRef}
                className={isActionGuide ? 'min-h-29.5' : 'min-h-39.5'}
              >
                <CoachmarkArrow />
                <div
                  key={payload.guide.id}
                  className="transition-opacity duration-200 motion-reduce:transition-none starting:opacity-0"
                >
                  <div className="pb-0.5 system-2xs-semibold-uppercase text-text-tertiary">
                    {payload.stepLabel}
                  </div>
                  {isActionGuide ? (
                    <CoachmarkTitle
                      render={<p />}
                      className="mt-1 system-md-medium text-text-primary"
                    >
                      {payload.guide.description}
                    </CoachmarkTitle>
                  ) : (
                    <>
                      <CoachmarkTitle className="mt-1 system-md-medium text-text-primary">
                        {payload.guide.title}
                      </CoachmarkTitle>
                      <CoachmarkDescription className="mt-1 system-xs-regular text-text-secondary">
                        {payload.guide.description}
                      </CoachmarkDescription>
                    </>
                  )}
                </div>
                <div
                  className={cn(
                    'mt-auto flex h-12 justify-between gap-3 pt-4',
                    isActionGuide ? 'items-end' : 'items-center',
                  )}
                >
                  <CoachmarkClose className="shrink-0 cursor-pointer rounded-md border-none bg-transparent p-0 text-start system-sm-regular text-text-tertiary outline-hidden hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid">
                    {payload.skipLabel}
                  </CoachmarkClose>
                  {!isActionGuide && (
                    <div className="flex shrink-0 items-center gap-1">
                      {payload.guide.learnMoreHref && (
                        <a
                          href={payload.guide.learnMoreHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={cn(
                            buttonVariants({ variant: 'ghost', size: 'medium' }),
                            'text-text-tertiary',
                          )}
                        >
                          {payload.guide.learnMoreLabel}
                          <span aria-hidden className="i-ri-arrow-right-up-line size-4" />
                        </a>
                      )}
                      <Button
                        ref={primaryActionRef}
                        variant="primary"
                        size="medium"
                        className="min-w-20 px-3"
                        onClick={stale ? undefined : onComplete}
                      >
                        {payload.guide.primaryActionLabel}
                      </Button>
                    </div>
                  )}
                </div>
              </CoachmarkPopup>
            </CoachmarkPositioner>
          </CoachmarkPortal>
        )
      }}
    </Coachmark>
  )
}
