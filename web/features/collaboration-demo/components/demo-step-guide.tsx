'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
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

type DemoStepGuideProps = {
  step: 'members' | 'comment' | 'playing'
  target: HTMLElement | null
  onAction: () => void
  onExit: () => void
}

export function DemoStepGuide({ step, target, onAction, onExit }: DemoStepGuideProps) {
  const { t } = useTranslation(['collaborationDemo'])
  const titleRef = useRef<HTMLHeadingElement>(null)
  const members = step === 'members'

  return (
    <Coachmark
      open={step !== 'playing'}
      onOpenChange={(_open, details) => {
        if (details.reason === 'close-press') onExit()
        else details.cancel()
      }}
      target={target}
      highlightSelectors={members ? ['[data-collaboration-demo-members]'] : undefined}
      modal="allow-target"
    >
      <CoachmarkPortal>
        <CoachmarkSpotlight />
        <CoachmarkPositioner side={members ? 'bottom' : 'inline-end'}>
          <CoachmarkPopup initialFocus={titleRef} className="min-h-39.5">
            <CoachmarkArrow />
            <CoachmarkTitle
              ref={titleRef}
              tabIndex={-1}
              className="system-md-medium text-text-primary outline-hidden"
            >
              <span className="block pb-1.5 system-2xs-semibold-uppercase text-text-secondary">
                {t(($) => $['steps.label'], { current: members ? 1 : 2, total: 2 })}
              </span>
              {members ? t(($) => $['steps.members.title']) : t(($) => $['steps.comment.title'])}
            </CoachmarkTitle>
            <CoachmarkDescription className="mt-1 system-xs-regular text-text-secondary">
              {members
                ? t(($) => $['steps.members.description'])
                : t(($) => $['steps.comment.description'])}
            </CoachmarkDescription>
            <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-4">
              <CoachmarkClose className="min-h-6 shrink-0 cursor-pointer rounded-md border-none bg-transparent p-0 text-start system-sm-regular text-text-secondary outline-hidden hover:text-text-primary focus-visible:ring-2 focus-visible:ring-state-accent-solid">
                {t(($) => $.exit)}
              </CoachmarkClose>
              <Button variant="primary" className="min-w-20 px-3" onClick={onAction}>
                {members
                  ? t(($) => $['steps.members.action'])
                  : t(($) => $['steps.comment.action'])}
              </Button>
            </div>
          </CoachmarkPopup>
        </CoachmarkPositioner>
      </CoachmarkPortal>
    </Coachmark>
  )
}
