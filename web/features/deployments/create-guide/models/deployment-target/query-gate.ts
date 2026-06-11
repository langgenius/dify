'use client'

import type { CreateGuideDslState } from '../../state/dsl-derived'
import type { GuideMethod, WorkflowSourceApp } from '../../types'
import { useAtomValue } from 'jotai'
import {
  dslReadErrorAtom,
  isReadingDslAtom,
} from '../../state/dsl-atoms'
import { selectedAppAtom } from '../../state/source-atoms'
import { methodAtom } from '../../state/workflow-atoms'
import { useCreateGuideDslModel } from '../dsl'

type DeploymentTargetQueryGate = {
  shouldLoadDeploymentTarget: boolean
  shouldLoadDslDeploymentOptions: boolean
  shouldLoadSourceDeploymentOptions: boolean
}

function createDeploymentTargetQueryGate({
  dslReadError,
  dslState,
  effectiveSelectedApp,
  isReadingDsl,
  method,
}: {
  dslReadError: boolean
  dslState: CreateGuideDslState
  effectiveSelectedApp?: WorkflowSourceApp
  isReadingDsl: boolean
  method: GuideMethod
}): DeploymentTargetQueryGate {
  const shouldLoadSourceDeploymentOptions = method === 'bindApp' && Boolean(effectiveSelectedApp?.id)
  const shouldLoadDslDeploymentOptions = method === 'importDsl'
    && dslState.hasDslContent
    && !isReadingDsl
    && !dslReadError
    && !dslState.dslUnsupportedMode

  return {
    shouldLoadDeploymentTarget: shouldLoadSourceDeploymentOptions || shouldLoadDslDeploymentOptions,
    shouldLoadDslDeploymentOptions,
    shouldLoadSourceDeploymentOptions,
  }
}

export function useDeploymentTargetQueryGate() {
  const method = useAtomValue(methodAtom)
  const dslReadError = useAtomValue(dslReadErrorAtom)
  const isReadingDsl = useAtomValue(isReadingDslAtom)
  const selectedApp = useAtomValue(selectedAppAtom)
  const dslState = useCreateGuideDslModel()
  // Target sections must share the same source/DSL gates so their query observers stay consistent.
  const queryGate = createDeploymentTargetQueryGate({
    dslReadError,
    dslState,
    effectiveSelectedApp: selectedApp,
    isReadingDsl,
    method,
  })

  return {
    dslState,
    effectiveSelectedApp: selectedApp,
    method,
    queryGate,
  }
}
