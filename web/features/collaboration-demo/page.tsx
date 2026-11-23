'use client'

import { useState } from 'react'
import { DemoHeader, DemoToolbar } from './components/demo-editor-chrome'
import { DemoStage } from './components/demo-stage'
import { DemoStepGuide } from './components/demo-step-guide'
import { useDemoOutcome } from './use-demo-outcome'
import { useExitDemo } from './use-exit-demo'

type Step = 'members' | 'comment' | 'playing'

export default function CollaborationDemoPage() {
  const exitDemo = useExitDemo()
  const endState = useDemoOutcome()
  const [step, setStep] = useState<Step>('members')
  const [membersTarget, setMembersTarget] = useState<HTMLElement | null>(null)
  const [commentTarget, setCommentTarget] = useState<HTMLButtonElement | null>(null)

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-background-body">
      <DemoHeader
        membersListed={step === 'members'}
        membersRef={setMembersTarget}
        onExit={exitDemo}
      />
      <DemoToolbar
        commentMode={step === 'playing'}
        onCommentModeChange={(pressed) => pressed && setStep('playing')}
        commentToolRef={setCommentTarget}
      />
      <DemoStage playing={step === 'playing'} endState={endState} onExit={exitDemo} />
      <DemoStepGuide
        step={step}
        target={step === 'members' ? membersTarget : commentTarget}
        onAction={() => setStep(step === 'members' ? 'comment' : 'playing')}
        onExit={exitDemo}
      />
    </div>
  )
}
