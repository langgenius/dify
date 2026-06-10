'use client'

import type { ReactNode } from 'react'
import { useAtomValue } from 'jotai'
import { stepAtom } from '../../state/workflow-atoms'
import { ReleaseActionButtons } from '../release-step/actions'
import { SourceActionButtons } from '../source-step/actions'
import { TargetActionButtons } from '../target-step/actions'

export function CreateDeploymentGuideActionBar() {
  const step = useAtomValue(stepAtom)

  return (
    <ActionBarFrame>
      {step === 'source' && <SourceActionButtons />}
      {step === 'release' && <ReleaseActionButtons />}
      {step === 'target' && <TargetActionButtons />}
    </ActionBarFrame>
  )
}

function ActionBarFrame({ children }: {
  children: ReactNode
}) {
  return (
    <div className="sticky bottom-0 z-10 -mx-5 mt-auto flex items-center justify-end gap-2 border-t border-divider-subtle bg-background-default-subtle/95 px-5 py-4 backdrop-blur-sm sm:-mx-8 sm:px-8 lg:-mx-10 lg:px-10">
      {children}
    </div>
  )
}
