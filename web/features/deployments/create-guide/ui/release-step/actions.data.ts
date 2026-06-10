'use client'

import { useAtomValue, useSetAtom } from 'jotai'
import { isWorkflowApp } from '@/features/deployments/app-mode'
import {
  createDslState,
} from '../../models/dsl'
import {
  hasReleaseInstanceNameConflict,
  isInitialReleaseReady,
} from '../../models/release'
import {
  createSelectedWorkflowSourceApp,
  createSourceStatus,
} from '../../models/source'
import {
  existingInstanceNamesFromQueryData,
  instanceNameConflictFromQueryData,
  useExistingInstanceNamesQuery,
  useInstanceNameConflictQuery,
} from '../../queries/source'
import {
  dslContentAtom,
  dslReadErrorAtom,
  isReadingDslAtom,
} from '../../state/dsl-atoms'
import {
  submittedReleaseFieldsAtom,
} from '../../state/release-atoms'
import {
  selectedAppAtom,
  selectSourceAppAtom,
} from '../../state/source-atoms'
import {
  resetDeploymentTargetOptionsAtom,
} from '../../state/target-atoms'
import {
  unsupportedDslNodesAtom,
} from '../../state/unsupported-dsl-atoms'
import {
  methodAtom,
  setStepAtom,
} from '../../state/workflow-atoms'

export function useReleaseAction() {
  const unsupportedDslNodes = useAtomValue(unsupportedDslNodesAtom)
  const setStep = useSetAtom(setStepAtom)
  const selectSourceApp = useSetAtom(selectSourceAppAtom)
  const resetTargetOptions = useSetAtom(resetDeploymentTargetOptionsAtom)
  const source = useReleaseActionSource()
  const appInstancesQuery = useExistingInstanceNamesQuery()
  const existingInstanceNames = existingInstanceNamesFromQueryData(appInstancesQuery.data)
  const initialReleaseReady = useInitialReleaseReady({
    existingInstanceNames,
    isSourceReady: source.isSourceReady,
  })
  const canGoNext = initialReleaseReady && unsupportedDslNodes.length === 0

  function handleBack() {
    setStep('source')
  }

  function handleNext() {
    if (!canGoNext)
      return
    if (source.method === 'bindApp' && (!source.effectiveSelectedApp?.id || !isWorkflowApp(source.effectiveSelectedApp)))
      return
    if (source.method === 'importDsl' && (!source.dslState.hasDslContent || source.isReadingDsl || source.dslReadError || source.dslState.dslUnsupportedMode))
      return

    if (source.method === 'bindApp' && source.effectiveSelectedApp)
      selectSourceApp(source.effectiveSelectedApp)
    resetTargetOptions()
    setStep('target')
  }

  return {
    canGoNext,
    handleBack,
    handleNext,
  }
}

function useReleaseActionSource() {
  const method = useAtomValue(methodAtom)
  const dslContent = useAtomValue(dslContentAtom)
  const dslReadError = useAtomValue(dslReadErrorAtom)
  const isReadingDsl = useAtomValue(isReadingDslAtom)
  const selectedApp = useAtomValue(selectedAppAtom)
  const dslState = createDslState({
    dslContent,
    dslReadError,
    isReadingDsl,
    method,
  })
  const effectiveSelectedApp = createSelectedWorkflowSourceApp(selectedApp)
  const source = createSourceStatus({
    dslFallbackAppName: '',
    dslReadError,
    dslState,
    effectiveSelectedApp,
    isReadingDsl,
    method,
  })

  return {
    dslReadError,
    dslState,
    effectiveSelectedApp: source.effectiveSelectedApp,
    isReadingDsl,
    isSourceReady: source.isSourceReady,
    method,
  }
}

function useInitialReleaseReady({
  existingInstanceNames,
  isSourceReady,
}: {
  existingInstanceNames: readonly string[]
  isSourceReady: boolean
}) {
  const {
    submittedInstanceName,
    submittedReleaseName,
  } = useAtomValue(submittedReleaseFieldsAtom)
  const instanceNameConflictQuery = useInstanceNameConflictQuery({
    enabled: Boolean(submittedInstanceName),
    submittedInstanceName,
  })
  const remoteInstanceNameConflict = instanceNameConflictFromQueryData(instanceNameConflictQuery.data, submittedInstanceName)
  const hasInstanceNameConflict = hasReleaseInstanceNameConflict({
    existingInstanceNames,
    remoteInstanceNameConflict,
    submittedInstanceName,
  })

  return isInitialReleaseReady({
    hasInstanceNameConflict,
    isCheckingInstanceNameConflict: Boolean(submittedInstanceName) && instanceNameConflictQuery.isLoading,
    isSourceReady,
    submittedInstanceName,
    submittedReleaseName,
  })
}
