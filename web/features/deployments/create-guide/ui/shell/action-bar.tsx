'use client'

import { useAtomValue } from 'jotai'
import { stepAtom } from '@/features/deployments/create-guide/state'
import { ReleaseActionButtons } from '../release-step/actions'
import { SourceActionButtons } from '../source-step/actions'
import {
  TargetBackButton,
  TargetDeployButton,
  TargetSkipDeploymentButton,
} from '../target-step/actions'

export function CreateDeploymentGuideActionBar() {
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
