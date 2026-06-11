'use client'

import type { GuideMethod, WorkflowSourceApp } from '../../types'
import { useAtomValue } from 'jotai'
import {
  dslReadErrorAtom,
  dslUnsupportedModeAtom,
  encodedDslContentAtom,
  hasDslContentAtom,
  isReadingDslAtom,
} from '../../state/dsl-atoms'
import { selectedAppAtom } from '../../state/source-atoms'
import { methodAtom } from '../../state/workflow-atoms'

type DeploymentTargetQueryGate = {
  shouldLoadDeploymentTarget: boolean
  shouldLoadDslDeploymentOptions: boolean
  shouldLoadSourceDeploymentOptions: boolean
}

function createDeploymentTargetQueryGate({
  dslReadError,
  dslUnsupportedMode,
  effectiveSelectedApp,
  hasDslContent,
  isReadingDsl,
  method,
}: {
  dslReadError: boolean
  dslUnsupportedMode: boolean
  effectiveSelectedApp?: WorkflowSourceApp
  hasDslContent: boolean
  isReadingDsl: boolean
  method: GuideMethod
}): DeploymentTargetQueryGate {
  const shouldLoadSourceDeploymentOptions = method === 'bindApp' && Boolean(effectiveSelectedApp?.id)
  const shouldLoadDslDeploymentOptions = method === 'importDsl'
    && hasDslContent
    && !isReadingDsl
    && !dslReadError
    && !dslUnsupportedMode

  return {
    shouldLoadDeploymentTarget: shouldLoadSourceDeploymentOptions || shouldLoadDslDeploymentOptions,
    shouldLoadDslDeploymentOptions,
    shouldLoadSourceDeploymentOptions,
  }
}

export function useDeploymentTargetQueryGate() {
  const method = useAtomValue(methodAtom)
  const dslReadError = useAtomValue(dslReadErrorAtom)
  const dslUnsupportedMode = useAtomValue(dslUnsupportedModeAtom)
  const encodedDslContent = useAtomValue(encodedDslContentAtom)
  const hasDslContent = useAtomValue(hasDslContentAtom)
  const isReadingDsl = useAtomValue(isReadingDslAtom)
  const selectedApp = useAtomValue(selectedAppAtom)
  // Target sections must share the same source/DSL gates so their query observers stay consistent.
  const queryGate = createDeploymentTargetQueryGate({
    dslReadError,
    dslUnsupportedMode,
    effectiveSelectedApp: selectedApp,
    hasDslContent,
    isReadingDsl,
    method,
  })

  return {
    encodedDslContent,
    effectiveSelectedApp: selectedApp,
    method,
    queryGate,
  }
}
