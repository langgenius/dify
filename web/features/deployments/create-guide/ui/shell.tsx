'use client'

import { useAtomValue } from 'jotai'
import { stepAtom } from '@/features/deployments/create-guide/state/primitives'
import { GuideCard, GuideFrame } from './layout'
import {
  ReleaseActionButtons,
  ReleaseStepContent,
} from './release-step'
import {
  SourceActionButtons,
  SourceStepContent,
} from './source-step'
import {
  TargetBackButton,
  TargetDeployButton,
  TargetSkipDeploymentButton,
  TargetStepContent,
} from './target-step'

export function CreateDeploymentGuideShell() {
  const step = useAtomValue(stepAtom)

  return (
    <GuideFrame activeStep={step}>
      <GuideCard
        contentScrollable={step !== 'source'}
        actions={<CreateDeploymentGuideActionBar />}
      >
        <CreateDeploymentGuideStepContent />
      </GuideCard>
    </GuideFrame>
  )
}

function CreateDeploymentGuideStepContent() {
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

function CreateDeploymentGuideActionBar() {
  const step = useAtomValue(stepAtom)

  return (
    <div className="sticky bottom-0 z-10 -mx-5 mt-auto flex items-center justify-end gap-2 border-t border-divider-subtle bg-background-default-subtle/95 px-5 py-4 backdrop-blur-sm sm:-mx-8 sm:px-8 lg:-mx-10 lg:px-10">
      {step === 'source' && <SourceActionButtons />}
      {step === 'release' && <ReleaseActionButtons />}
      {step === 'target' && (
        <>
          <TargetBackButton />
          <TargetSkipDeploymentButton />
          <TargetDeployButton />
        </>
      )}
    </div>
  )
}
