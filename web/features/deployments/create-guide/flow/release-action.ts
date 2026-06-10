'use client'

import { useAtomValue, useSetAtom } from 'jotai'
import { isWorkflowApp } from '@/features/deployments/app-mode'
import { useReleaseStepActionSnapshot } from '../models/release'
import {
  selectSourceAppAtom,
} from '../state/source-atoms'
import {
  resetDeploymentTargetOptionsAtom,
} from '../state/target-atoms'
import {
  unsupportedDslNodesAtom,
} from '../state/unsupported-dsl-atoms'
import { setStepAtom } from '../state/workflow-atoms'

export function useCreateDeploymentGuideReleaseAction() {
  const unsupportedDslNodes = useAtomValue(unsupportedDslNodesAtom)
  const setStep = useSetAtom(setStepAtom)
  const selectSourceApp = useSetAtom(selectSourceAppAtom)
  const resetTargetOptions = useSetAtom(resetDeploymentTargetOptionsAtom)
  const releaseAction = useReleaseStepActionSnapshot()
  const canGoNext = releaseAction.isInitialReleaseReady && unsupportedDslNodes.length === 0

  function handleBack() {
    setStep('source')
  }

  function selectEffectiveSourceApp() {
    if (releaseAction.method === 'bindApp' && releaseAction.effectiveSelectedApp)
      selectSourceApp(releaseAction.effectiveSelectedApp)
  }

  function handleNext() {
    if (!canGoNext)
      return
    if (releaseAction.method === 'bindApp' && (!releaseAction.effectiveSelectedApp?.id || !isWorkflowApp(releaseAction.effectiveSelectedApp)))
      return
    if (releaseAction.method === 'importDsl' && (!releaseAction.dslState.hasDslContent || releaseAction.isReadingDsl || releaseAction.dslReadError || releaseAction.dslState.dslUnsupportedMode))
      return

    selectEffectiveSourceApp()
    resetTargetOptions()
    setStep('target')
  }

  return {
    canGoNext,
    handleBack,
    handleNext,
  }
}
