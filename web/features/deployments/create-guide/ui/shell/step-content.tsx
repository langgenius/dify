'use client'

import { useAtomValue } from 'jotai'
import { stepAtom } from '@/features/deployments/create-guide/state'
import { ReleaseStepContent } from '../release-step/release-step-content'
import { SourceStepContent } from '../source-step/source-step-content'
import { TargetStepContent } from '../target-step'

export function CreateDeploymentGuideStepContent() {
  const step = useAtomValue(stepAtom)

  if (step === 'source') {
    return (
      <div className="flex h-full min-h-0 flex-col gap-7 pb-4">
        <SourceStepContent />
      </div>
    )
  }

  if (step === 'release') {
    return (
      <div className="flex h-full min-h-0 flex-col gap-7 pb-4">
        <ReleaseStepContent />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-7 pb-4">
      <TargetStepContent />
    </div>
  )
}
