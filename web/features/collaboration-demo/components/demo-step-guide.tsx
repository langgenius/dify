'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Coachmark,
  CoachmarkArrow,
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
  onAction: () => void
  onExit: () => void
}

const focusOnMount = (element: HTMLElement | null) => element?.focus()

export function DemoStepGuide({ step, target, onAction, onExit }: DemoStepGuideProps) {
  const { t } = useTranslation(['collaborationDemo'])
  const titleRef = useRef<HTMLHeadingElement>(null)
  const copy =
    step === 'members'
      ? {
          index: 1,
          side: 'bottom' as const,
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
      highlightSelectors={step === 'members' ? ['[data-collaboration-demo-members]'] : undefined}
      step={step}
      payload={copy}
      interaction="target-only"
    >
      {({ payload, stale }) => (
        <CoachmarkPortal>
          <CoachmarkSpotlight />
          <CoachmarkPositioner side={payload.side}>
            <CoachmarkPopup initialFocus={titleRef} className="min-h-39.5">
              <CoachmarkArrow />
              <div
                key={payload.index}
                className="motion-safe:transition-opacity motion-safe:duration-200 motion-safe:starting:opacity-0"
              >
                <CoachmarkTitle
                  ref={payload.index === 1 ? titleRef : focusOnMount}
                  tabIndex={-1}
                  className="system-md-medium text-text-primary outline-hidden"
                >
                  <span className="block pb-1.5 system-2xs-semibold-uppercase text-text-secondary">
                    {t(($) => $['steps.label'], { current: payload.index, total: 2 })}
                  </span>
                  {payload.title}
                </CoachmarkTitle>
                <CoachmarkDescription className="mt-1 system-xs-regular text-text-secondary">
                  {payload.description}
                </CoachmarkDescription>
              </div>
              <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-4">
                <button
                  type="button"
                  className="min-h-6 shrink-0 cursor-pointer rounded-md border-none bg-transparent p-0 text-start system-sm-regular text-text-secondary outline-hidden hover:text-text-primary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                  onClick={onExit}
                >
                  {t(($) => $.exit)}
                </button>
                <Button
                  variant="primary"
                  className="min-w-20 px-3"
                  onClick={stale ? undefined : onAction}
                  onKeyDown={(event) => {
                    if (event.key !== 'Tab' || event.shiftKey || step !== 'comment' || !target)
                      return
                    event.preventDefault()
                    target.focus()
                  }}
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
