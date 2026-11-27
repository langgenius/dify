'use client'

import type { TourOutcome } from './analytics'
import { useAtomValue } from 'jotai'
import { useEffect, useRef, useState } from 'react'
import { useAmplitudeInitialized } from '@/app/components/base/amplitude/use-amplitude-initialized'
import { currentWorkspaceAtom } from '@/context/workspace-state'
import { trackCollabTour } from './analytics'
import { DemoHeader, DemoToolbar } from './components/demo-editor-chrome'
import { DemoStage } from './components/demo-stage'
import { DemoStepGuide } from './components/demo-step-guide'
import { useDemoOutcome } from './use-demo-outcome'
import { useExitDemo } from './use-exit-demo'

type Step = 'members' | 'comment' | 'playing'

export default function CollaborationDemoPage() {
  const exitDemo = useExitDemo()
  const endState = useDemoOutcome()
  const workspace = useAtomValue(currentWorkspaceAtom)
  const amplitudeReady = useAmplitudeInitialized()
  const [step, setStep] = useState<Step>('members')
  const [membersTarget, setMembersTarget] = useState<HTMLElement | null>(null)
  const [commentTarget, setCommentTarget] = useState<HTMLButtonElement | null>(null)
  const [guideShown, setGuideShown] = useState(false)
  const trackedRef = useRef({ shown: false, outcome: false })

  useEffect(() => {
    if (!guideShown || !amplitudeReady || !workspace.id || trackedRef.current.shown) return
    trackedRef.current.shown = true
    trackCollabTour({ action: 'tour_shown' }, workspace)
  }, [guideShown, amplitudeReady, workspace])

  const recordOutcome = (outcome: TourOutcome) => {
    if (!trackedRef.current.shown || trackedRef.current.outcome) return
    trackedRef.current.outcome = true
    trackCollabTour(outcome, workspace)
  }

  const exit = () => {
    recordOutcome({ action: 'tour_skipped', step: step === 'playing' ? 'playback' : step })
    exitDemo()
  }

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-background-body">
      <DemoHeader membersListed={step === 'members'} membersRef={setMembersTarget} onExit={exit} />
      <DemoToolbar
        commentMode={step === 'playing'}
        onCommentModeChange={(pressed) => pressed && setStep('playing')}
        commentToolRef={setCommentTarget}
      />
      <DemoStage
        playing={step === 'playing'}
        endState={endState}
        onOutcome={recordOutcome}
        onExit={exit}
      />
      <DemoStepGuide
        step={step}
        target={step === 'members' ? membersTarget : commentTarget}
        onShown={() => setGuideShown(true)}
        onAction={() => setStep(step === 'members' ? 'comment' : 'playing')}
        onExit={exit}
      />
    </div>
  )
}
