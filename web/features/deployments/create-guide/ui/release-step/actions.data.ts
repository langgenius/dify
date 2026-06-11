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

function useHasUnsupportedDslNodes() {
  return useAtomValue(unsupportedDslNodesAtom).length > 0
}

export function useReleaseCanEnterTargetStep() {
  const sourceStatus = useSelectedSourceStatus()
  const releaseFields = useSubmittedReleaseFieldsStatus()
  const hasUnsupportedDslNodes = useHasUnsupportedDslNodes()

  return sourceStatus.isReady
    && releaseFields.hasInstanceName
    && releaseFields.hasReleaseName
    && !releaseFields.hasInstanceNameConflict
    && !releaseFields.isCheckingInstanceNameConflict
    && !hasUnsupportedDslNodes
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
