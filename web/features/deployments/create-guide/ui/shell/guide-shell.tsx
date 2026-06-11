'use client'

import { useAtomValue } from 'jotai'
import { stepAtom } from '@/features/deployments/create-guide/state'
import { CreateDeploymentGuideActionBar } from './action-bar'
import { GuideCard, GuideFrame } from './layout'
import { CreateDeploymentGuideStepContent } from './step-content'

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
