'use client'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import WorkflowPreview from '@/app/components/workflow/workflow-preview'
import { DemoHeader, DemoToolbar } from './components/demo-editor-chrome'
import { DemoPlayback } from './components/demo-playback'
import { DemoStepGuide } from './components/demo-step-guide'
import { createDemoGraph } from './demo-graph'
import { DemoViewportFit } from './demo-viewport'
import { useDemoOutcome } from './use-demo-outcome'
import { useExitDemo } from './use-exit-demo'

type Step = 'members' | 'comment' | 'playing'

export default function CollaborationDemoPage() {
  const { t } = useTranslation(['collaborationDemo'])
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
      <WorkflowPreview
        {...createDemoGraph({
          start: t(($) => $['nodes.start']),
          checkOrder: t(($) => $['nodes.checkOrder']),
          lookupRefund: t(($) => $['nodes.lookupRefund']),
          generateReply: t(($) => $['nodes.generateReply']),
          refundStatus: t(($) => $['nodes.refundStatus']),
          askOrder: t(($) => $['nodes.askOrder']),
        })}
        miniMapToRight
      >
        <DemoViewportFit />
        {step === 'playing' && <DemoPlayback endState={endState} />}
      </WorkflowPreview>
      <DemoStepGuide
        step={step}
        target={step === 'members' ? membersTarget : commentTarget}
        onAction={() => setStep(step === 'members' ? 'comment' : 'playing')}
        onExit={exitDemo}
      />
    </div>
  )
}
