'use client'

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
  const isActionGuide = getStepByStepTourGuideKind(guide) === 'action'

  return (
    <Coachmark
      open
      onOpenChange={onSkip}
      target={
        targetElement?.matches(getStepByStepTourTargetSelector(guide.target)) ? targetElement : null
      }
      highlightSelectors={guide.highlightPartSelectors}
      modal={interactionPolicy === 'target-only' ? 'allow-target' : true}
    >
      <CoachmarkPortal>
        <CoachmarkSpotlight data-step-by-step-tour-highlight="" />
        <CoachmarkPositioner side={placement}>
          <CoachmarkPopup
            initialFocus={primaryActionRef}
            className={isActionGuide ? 'min-h-29.5' : 'min-h-39.5'}
          >
            <CoachmarkArrow />
            <div
              key={guide.id}
              className="flex min-h-0 flex-col overflow-y-auto motion-safe:transition-opacity motion-safe:duration-200 motion-safe:starting:opacity-0"
            >
              {isActionGuide ? (
                <CoachmarkTitle className="mt-1 system-md-medium text-text-primary">
                  {guide.description}
                </CoachmarkTitle>
              ) : (
                <>
                  <CoachmarkTitle className="mt-1 system-md-medium text-text-primary">
                    {guide.title}
                  </CoachmarkTitle>
                  <CoachmarkDescription className="mt-1 system-xs-regular text-text-secondary">
                    {guide.description}
                  </CoachmarkDescription>
                </>
              )}
              <div className="order-first pb-0.5 system-2xs-semibold-uppercase text-text-tertiary">
                {stepLabel}
              </div>
            </div>
            <div
              className={cn(
                'mt-auto flex min-h-12 flex-wrap justify-between gap-3 pt-4',
                isActionGuide ? 'items-end' : 'items-center',
              )}
            >
              <CoachmarkClose className="shrink-0 cursor-pointer rounded-md border-none bg-transparent p-0 text-start system-sm-regular text-text-tertiary outline-hidden hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid">
                {skipLabel}
              </CoachmarkClose>
              {!isActionGuide && (
                <div className="flex shrink-0 items-center gap-1">
                  {guide.learnMoreHref && (
                    <a
                      href={guide.learnMoreHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(
                        buttonVariants({ variant: 'ghost', size: 'medium' }),
                        'text-text-tertiary',
                      )}
                    >
                      {guide.learnMoreLabel}
                      <span aria-hidden className="i-ri-arrow-right-up-line size-4" />
                    </a>
                  )}
                  <Button
                    ref={primaryActionRef}
                    variant="primary"
                    size="medium"
                    className="min-w-20 px-3"
                    onClick={onComplete}
                  >
                    {guide.primaryActionLabel}
                  </Button>
                </div>
              )}
            </div>
          </CoachmarkPopup>
        </CoachmarkPositioner>
      </CoachmarkPortal>
    </Coachmark>
  )
}
