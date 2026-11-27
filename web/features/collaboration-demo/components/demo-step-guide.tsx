'use client'

import { Button } from '@langgenius/dify-ui/button'
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
import { useTranslation } from 'react-i18next'

type DemoStep = 'members' | 'comment' | 'playing'

type DemoStepGuideProps = {
  step: DemoStep
  target: HTMLElement | null
  onShown: () => void
  onAction: () => void
  onExit: () => void
}

export function DemoStepGuide({ step, target, onShown, onAction, onExit }: DemoStepGuideProps) {
  const { t } = useTranslation(['collaborationDemo'])
  const actionRef = useRef<HTMLButtonElement>(null)

  return (
    <Coachmark
      open={step !== 'playing'}
      onOpenChange={(_open, details) => {
        if (details.reason === 'close-press') onExit()
      }}
      onStepShown={onShown}
      target={target}
      highlightSelectors={step === 'members' ? ['[data-collaboration-demo-members]'] : undefined}
      modal={step === 'members' ? true : 'allow-target'}
      payload={step}
    >
      {({ payload: shownStep }) => {
        const members = shownStep === 'members'

        return (
          <CoachmarkPortal>
            <CoachmarkSpotlight />
            <CoachmarkPositioner side={members ? 'bottom' : 'inline-end'}>
              <CoachmarkPopup initialFocus={actionRef} className="min-h-39.5">
                <CoachmarkArrow />
                <CoachmarkTitle>
                  <CoachmarkStepLabel>
                    {t(($) => $['steps.label'], { current: members ? 1 : 2, total: 2 })}
                  </CoachmarkStepLabel>
                  {members
                    ? t(($) => $['steps.members.title'])
                    : t(($) => $['steps.comment.title'])}
                </CoachmarkTitle>
                <CoachmarkDescription>
                  {members
                    ? t(($) => $['steps.members.description'])
                    : t(($) => $['steps.comment.description'])}
                </CoachmarkDescription>
                <CoachmarkActions>
                  <CoachmarkClose>{t(($) => $.exit)}</CoachmarkClose>
                  <Button
                    ref={actionRef}
                    variant="primary"
                    className="min-w-20 px-3 in-data-pending:opacity-50"
                    onClick={onAction}
                  >
                    {members
                      ? t(($) => $['steps.members.action'])
                      : t(($) => $['steps.comment.action'])}
                  </Button>
                </CoachmarkActions>
              </CoachmarkPopup>
            </CoachmarkPositioner>
          </CoachmarkPortal>
        )
      }}
    </Coachmark>
  )
}
