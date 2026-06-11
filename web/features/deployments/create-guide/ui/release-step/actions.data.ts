'use client'

import { useAtomValue, useSetAtom } from 'jotai'
import {
  useReleaseInstanceNameConflict,
  useReleaseInstanceNameConflictChecking,
} from '../../models/release'
import { useSourceReady } from '../../models/source'
import { submittedReleaseFieldsAtom } from '../../state/release-atoms'
import {
  resetDeploymentTargetOptionsAtom,
} from '../../state/target-atoms'
import {
  unsupportedDslNodesAtom,
} from '../../state/unsupported-dsl-atoms'
import {
  setStepAtom,
} from '../../state/workflow-atoms'

export function useReleaseCanEnterTargetStep() {
  const sourceReady = useSourceReady()
  const {
    submittedInstanceName,
    submittedReleaseName,
  } = useAtomValue(submittedReleaseFieldsAtom)
  const hasInstanceNameConflict = useReleaseInstanceNameConflict()
  const isCheckingInstanceNameConflict = useReleaseInstanceNameConflictChecking()
  const unsupportedDslNodes = useAtomValue(unsupportedDslNodesAtom)

  return sourceReady
    && Boolean(submittedInstanceName)
    && Boolean(submittedReleaseName)
    && !hasInstanceNameConflict
    && !isCheckingInstanceNameConflict
    && unsupportedDslNodes.length === 0
}

export function useReleaseNextAction(canEnterTargetStep: boolean) {
  const setStep = useSetAtom(setStepAtom)
  const resetTargetOptions = useSetAtom(resetDeploymentTargetOptionsAtom)

  function handleNext() {
    if (!canEnterTargetStep)
      return

    resetTargetOptions()
    setStep('target')
  }

  return handleNext
}
