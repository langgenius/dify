'use client'

import { useAtomValue, useSetAtom } from 'jotai'
import {
  useSourceStepActionSnapshot,
} from '../models/source'
import {
  applyReleaseDefaultsAtom,
} from '../state/release-atoms'
import {
  selectSourceAppAtom,
} from '../state/source-atoms'
import {
  unsupportedDslNodesAtom,
} from '../state/unsupported-dsl-atoms'
import { setStepAtom } from '../state/workflow-atoms'

export function useCreateDeploymentGuideSourceAction() {
  const source = useSourceStepActionSnapshot()
  const unsupportedDslNodes = useAtomValue(unsupportedDslNodesAtom)
  const setStep = useSetAtom(setStepAtom)
  const selectSourceApp = useSetAtom(selectSourceAppAtom)
  const applyReleaseDefaults = useSetAtom(applyReleaseDefaultsAtom)
  const canGoNext = source.isSourceReady && unsupportedDslNodes.length === 0

  function handleNext() {
    if (!canGoNext)
      return

    if (source.method === 'bindApp' && source.effectiveSelectedApp)
      selectSourceApp(source.effectiveSelectedApp)

    applyReleaseDefaults({
      defaultReleaseName: source.defaultedReleaseName,
      existingNames: source.existingInstanceNames,
      sourceName: source.sourceName,
    })
    setStep('release')
  }

  return {
    canGoNext,
    handleNext,
  }
}
