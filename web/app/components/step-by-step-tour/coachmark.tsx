'use client'

import type { CoachmarkSide } from '@langgenius/dify-ui/coachmark'
import type { StepByStepTourGuide, StepByStepTourGuideInteractionPolicy } from './target-registry'
import { Button, buttonVariants } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Coachmark,
  CoachmarkActions,
  CoachmarkArrow,
  CoachmarkClose,
  CoachmarkDescription,
  CoachmarkPopup,
  CoachmarkPortal,
  CoachmarkPositioner,
  CoachmarkSpotlight,
  CoachmarkStepLabel,
  CoachmarkTitle,
} from '@langgenius/dify-ui/coachmark'
import { useRef } from 'react'
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
  placement?: Extract<CoachmarkSide, 'bottom' | 'inline-end' | 'top'>
  stepLabel: string
  skipLabel: string
  interactionPolicy: StepByStepTourGuideInteractionPolicy
  onStepShown: (guide: Pick<StepByStepTourGuide, 'id' | 'taskId'>) => void
  onSkip: () => void
  onComplete: () => void
}

export function StepByStepTourCoachmark({
  guide,
  placement = 'bottom',
  stepLabel,
  skipLabel,
  interactionPolicy,
  onStepShown,
  onSkip,
  onComplete,
}: StepByStepTourCoachmarkProps) {
  const primaryActionRef = useRef<HTMLButtonElement>(null)

  return (
    <Coachmark
      open
      onOpenChange={onSkip}
      onStepShown={({ guide: shownGuide }) => onStepShown(shownGuide)}
      target={getStepByStepTourTargetSelector(guide.target)}
      highlightSelectors={guide.highlightPartSelectors}
      modal={interactionPolicy === 'target-only' ? 'allow-target' : true}
      payload={{ guide, placement, stepLabel }}
    >
      {({
        payload: { guide: shownGuide, placement: shownPlacement, stepLabel: shownStepLabel },
      }) => {
        const isActionGuide = getStepByStepTourGuideKind(shownGuide) === 'action'

        return (
          <CoachmarkPortal>
            <CoachmarkSpotlight />
            <CoachmarkPositioner side={shownPlacement}>
              <CoachmarkPopup
                initialFocus={isActionGuide ? undefined : primaryActionRef}
                finalFocus={false}
                className={isActionGuide ? 'min-h-29.5' : 'min-h-39.5'}
              >
                <CoachmarkArrow />
                <CoachmarkTitle>
                  <CoachmarkStepLabel>{shownStepLabel}</CoachmarkStepLabel>
                  {isActionGuide ? shownGuide.description : shownGuide.title}
                </CoachmarkTitle>
                {!isActionGuide && (
                  <CoachmarkDescription>{shownGuide.description}</CoachmarkDescription>
                )}
                <CoachmarkActions className={isActionGuide ? 'items-end' : undefined}>
                  <CoachmarkClose>{skipLabel}</CoachmarkClose>
                  {!isActionGuide && shownGuide.learnMoreHref && (
                    <a
                      href={shownGuide.learnMoreHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(
                        buttonVariants({ variant: 'ghost', size: 'medium' }),
                        'text-text-tertiary',
                      )}
                    >
                      {shownGuide.learnMoreLabel}
                      <span aria-hidden className="i-ri-arrow-right-up-line size-4" />
                    </a>
                  )}
                  {!isActionGuide && (
                    <Button
                      ref={primaryActionRef}
                      variant="primary"
                      size="medium"
                      className="min-w-20 px-3 in-data-pending:opacity-50"
                      onClick={onComplete}
                    >
                      {shownGuide.primaryActionLabel}
                    </Button>
                  )}
                </CoachmarkActions>
              </CoachmarkPopup>
            </CoachmarkPositioner>
          </CoachmarkPortal>
        )
      }}
    </Coachmark>
  )
}
