'use client'

import { useAtomValue, useSetAtom } from 'jotai'
import {
  useReleaseInstanceNameConflictQuery,
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

function useReleaseTargetStepReady() {
  const sourceReady = useSourceReady()
  const {
    submittedInstanceName,
    submittedReleaseName,
  } = useAtomValue(submittedReleaseFieldsAtom)
  const {
    hasInstanceNameConflict,
    instanceNameConflictQuery,
  } = useReleaseInstanceNameConflictQuery()
  const unsupportedDslNodes = useAtomValue(unsupportedDslNodesAtom)
  const isCheckingInstanceNameConflict = Boolean(submittedInstanceName) && instanceNameConflictQuery.isLoading

  return sourceReady
    && Boolean(submittedInstanceName)
    && Boolean(submittedReleaseName)
    && !hasInstanceNameConflict
    && !isCheckingInstanceNameConflict
    && unsupportedDslNodes.length === 0
}

export function useReleaseNextDisabled() {
  return !useReleaseTargetStepReady()
}

export function useReleaseNextAction() {
  const setStep = useSetAtom(setStepAtom)
  const resetTargetOptions = useSetAtom(resetDeploymentTargetOptionsAtom)
  const targetStepReady = useReleaseTargetStepReady()

  function handleNext() {
    if (!targetStepReady)
      return

    resetTargetOptions()
    setStep('target')
  }

  return handleNext
}
