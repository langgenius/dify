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
  step: 'members' | 'comment'
  target: HTMLElement | null
  highlightSelectors?: string[]
  onAction: () => void
  onExit: () => void
}

export function DemoStepGuide({
  step,
  target,
  highlightSelectors,
  onAction,
  onExit,
}: DemoStepGuideProps) {
  const { t } = useTranslation(['collaborationDemo'])
  const primaryActionRef = useRef<HTMLButtonElement>(null)
  const copy =
    step === 'members'
      ? {
          index: 1,
          side: 'inline-start' as const,
          title: t(($) => $['steps.members.title']),
          description: t(($) => $['steps.members.description']),
          action: t(($) => $['steps.members.action']),
        }
      : {
          index: 2,
          side: 'inline-end' as const,
          title: t(($) => $['steps.comment.title']),
          description: t(($) => $['steps.comment.description']),
          action: t(($) => $['steps.comment.action']),
        }

  return (
    <Coachmark
      target={target}
      highlightSelectors={highlightSelectors}
      step={step}
      payload={copy}
      interaction="target-only"
      onOpenChange={(open, { reason }) => {
        if (!open && (reason === 'escape-key' || reason === 'close-press')) onExit()
      }}
    >
      {({ payload, stale }) => (
        <CoachmarkPortal>
          <CoachmarkSpotlight />
          <CoachmarkPositioner side={payload.side}>
            <CoachmarkPopup initialFocus={primaryActionRef} className="min-h-39.5">
              <CoachmarkArrow />
              <div
                key={payload.index}
                className="transition-opacity duration-200 motion-reduce:transition-none starting:opacity-0"
              >
                <div className="pb-0.5 system-2xs-semibold-uppercase text-text-tertiary">
                  {t(($) => $['steps.label'], { current: payload.index, total: 2 })}
                </div>
                <CoachmarkTitle className="mt-1 system-md-medium text-text-primary">
                  {payload.title}
                </CoachmarkTitle>
                <CoachmarkDescription className="mt-1 system-xs-regular text-text-secondary">
                  {payload.description}
                </CoachmarkDescription>
              </div>
              <div className="mt-auto flex h-12 items-center justify-between gap-3 pt-4">
                <CoachmarkClose className="shrink-0 cursor-pointer rounded-md border-none bg-transparent p-0 text-start system-sm-regular text-text-tertiary outline-hidden hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid">
                  {t(($) => $.exit)}
                </CoachmarkClose>
                <Button
                  ref={primaryActionRef}
                  variant="primary"
                  className="min-w-20 px-3"
                  onClick={stale ? undefined : onAction}
                >
                  {payload.action}
                </Button>
              </div>
            </CoachmarkPopup>
          </CoachmarkPositioner>
        </CoachmarkPortal>
      )}
    </Coachmark>
  )
}
