'use client'

import { useAtomValue, useSetAtom } from 'jotai'
import { useSubmittedReleaseFieldsStatus } from '../../models/release'
import { useSelectedSourceStatus } from '../../models/source'
import { selectSourceAppAtom } from '../../state/source-atoms'
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
  const sourceStatus = useSelectedSourceStatus()
  const releaseFields = useSubmittedReleaseFieldsStatus()
  const unsupportedDslNodes = useAtomValue(unsupportedDslNodesAtom)

  return sourceStatus.isReady
    && releaseFields.hasInstanceName
    && releaseFields.hasReleaseName
    && !releaseFields.hasInstanceNameConflict
    && !releaseFields.isCheckingInstanceNameConflict
    && unsupportedDslNodes.length === 0
}

export function useReleaseNextAction(canEnterTargetStep: boolean) {
  const source = useSelectedSourceStatus()
  const setStep = useSetAtom(setStepAtom)
  const selectSourceApp = useSetAtom(selectSourceAppAtom)
  const resetTargetOptions = useSetAtom(resetDeploymentTargetOptionsAtom)

  function handleNext() {
    if (!canEnterTargetStep)
      return

    if (source.sourceAppToSelect)
      selectSourceApp(source.sourceAppToSelect)
    resetTargetOptions()
    setStep('target')
  }

  return handleNext
}
