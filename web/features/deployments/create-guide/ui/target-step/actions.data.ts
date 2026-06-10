'use client'

import type { DeploymentTargetSubmissionState } from '../../submission/types'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  createDeploymentTargetBindings,
} from '../../models/deployment-target/bindings'
import {
  createDeploymentTargetEnvVars,
} from '../../models/deployment-target/env-vars'
import {
  createDeploymentTargetEnvironment,
} from '../../models/deployment-target/environment'
import {
  canDeployToTarget,
  canSkipDeployment,
} from '../../models/deployment-target/readiness'
import {
  createDslState,
} from '../../models/dsl'
import {
  isInitialReleaseReady,
} from '../../models/release'
import {
  createSelectedWorkflowSourceApp,
  createSourceStatus,
} from '../../models/source'
import { useDeployableEnvironmentsQuery } from '../../queries/target-environments'
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
} from '../../state/source-atoms'
import {
  envVarValuesAtom,
  manualBindingSelectionsAtom,
  selectedEnvironmentIdAtom,
} from '../../state/target-atoms'
import {
  unsupportedDslNodesAtom,
} from '../../state/unsupported-dsl-atoms'
import {
  methodAtom,
  setStepAtom,
} from '../../state/workflow-atoms'
import { useCreateDeploymentSubmission } from '../../submission'
import {
  useDeploymentOptionsQueryResult,
  useDeploymentTargetQueryModel,
} from './deployment-options-query'

type DeploymentOptionsQuery = ReturnType<typeof useDeploymentOptionsQueryResult>['deploymentOptionsQuery']

type DeploymentTargetActionState = DeploymentTargetSubmissionState & {
  deploymentOptionsQuery: DeploymentOptionsQuery
  isBindingLoading: boolean
  isEnvironmentError: boolean
  isEnvironmentLoading: boolean
  requiredBindingsReady: boolean
  shouldLoadDeploymentTarget: boolean
}

export function useTargetAction() {
  const source = useTargetStepSource()
  const unsupportedDslNodes = useAtomValue(unsupportedDslNodesAtom)
  const setStep = useSetAtom(setStepAtom)
  const isSubmittedReleaseReady = useSubmittedInitialReleaseReady({
    isSourceReady: source.isSourceReady,
  })
  const targetActionState = useDeploymentTargetActionModel(source.effectiveSelectedApp)
  const hasUnsupportedDslNodes = unsupportedDslNodes.length > 0
  const canDeploy = canDeployToTarget({
    hasUnsupportedDslNodes,
    isBindingError: targetActionState.deploymentOptionsQuery.isError,
    isBindingLoading: targetActionState.isBindingLoading,
    isEnvironmentError: targetActionState.isEnvironmentError,
    isEnvironmentLoading: targetActionState.isEnvironmentLoading,
    isInitialReleaseReady: isSubmittedReleaseReady,
    requiredBindingsReady: targetActionState.requiredBindingsReady,
    requiredEnvVarsReady: targetActionState.requiredEnvVarsReady,
    selectedEnvironmentId: targetActionState.selectedEnvironment?.id,
    shouldLoadDeploymentTarget: targetActionState.shouldLoadDeploymentTarget,
  })
  const canSkip = canSkipDeployment({
    hasUnsupportedDslNodes,
    isBindingError: targetActionState.deploymentOptionsQuery.isError,
    isInitialReleaseReady: isSubmittedReleaseReady,
  })
  const {
    createDeploymentAndRelease,
    isDeploying,
    isSkippingReleaseOnly,
  } = useCreateDeploymentSubmission({
    effectiveSelectedApp: source.effectiveSelectedApp,
    hasInstanceNameConflict: false,
    isInitialReleaseReady: isSubmittedReleaseReady,
    targetSubmissionState: targetActionState,
  })

  function handleBack() {
    if (!isDeploying)
      setStep('release')
  }

  async function handleDeploy() {
    await createDeploymentAndRelease({ deployToEnvironment: true })
  }

  async function handleSkipDeployment() {
    if (!canSkip)
      return

    await createDeploymentAndRelease({ deployToEnvironment: false })
  }

  return {
    canDeploy,
    canSkipDeployment: canSkip,
    handleBack,
    handleDeploy,
    handleSkipDeployment,
    isDeploying,
    isSkippingDeployment: isSkippingReleaseOnly,
  }
}

function useTargetStepSource() {
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
    effectiveSelectedApp: source.effectiveSelectedApp,
    isSourceReady: source.isSourceReady,
  }
}

function useSubmittedInitialReleaseReady({
  isSourceReady,
}: {
  isSourceReady: boolean
}) {
  const {
    submittedInstanceName,
    submittedReleaseName,
  } = useAtomValue(submittedReleaseFieldsAtom)
  return isInitialReleaseReady({
    hasInstanceNameConflict: false,
    isCheckingInstanceNameConflict: false,
    isSourceReady,
    submittedInstanceName,
    submittedReleaseName,
  })
}

function useDeploymentTargetActionModel(
  effectiveSelectedApp: ReturnType<typeof useTargetStepSource>['effectiveSelectedApp'],
): DeploymentTargetActionState {
  const {
    dslState,
    method,
    queryGate,
  } = useDeploymentTargetQueryModel({
    effectiveSelectedApp,
  })
  const shouldLoadDeploymentTarget = queryGate.shouldLoadDeploymentTarget
  const selectedEnvironmentId = useAtomValue(selectedEnvironmentIdAtom)
  const manualBindingSelections = useAtomValue(manualBindingSelectionsAtom)
  const envVarValues = useAtomValue(envVarValuesAtom)
  const dslContent = useAtomValue(dslContentAtom)
  const deployableEnvironmentsQuery = useDeployableEnvironmentsQuery(shouldLoadDeploymentTarget)
  const environments = shouldLoadDeploymentTarget
    ? deployableEnvironmentsQuery.data?.data ?? []
    : []
  const {
    selectedEnvironment,
  } = createDeploymentTargetEnvironment({
    environments,
    selectedEnvironmentId,
  })
  const deploymentOptionsResult = useDeploymentOptionsQueryResult({
    dslState,
    effectiveSelectedApp,
    method,
    queryGate,
    syncUnsupportedDslNodes: false,
  })
  const targetBindings = createDeploymentTargetBindings({
    credentialSlots: deploymentOptionsResult.deploymentOptions?.credentialSlots,
    manualBindingSelections,
    shouldLoadDeploymentTarget,
  })
  const targetEnvVars = createDeploymentTargetEnvVars({
    dslContent,
    envVarValues,
    method,
    shouldLoadDeploymentTarget,
    slots: deploymentOptionsResult.deploymentOptions?.envVarSlots,
  })
  const isBindingLoading = shouldLoadDeploymentTarget
    && (deploymentOptionsResult.deploymentOptionsQuery.isLoading || (deploymentOptionsResult.deploymentOptionsQuery.isFetching && !deploymentOptionsResult.deploymentOptionsQuery.data))
  const isEnvironmentLoading = shouldLoadDeploymentTarget
    && (deployableEnvironmentsQuery.isLoading || (deployableEnvironmentsQuery.isFetching && !deployableEnvironmentsQuery.data))

  return {
    bindingSelections: targetBindings.bindingSelections,
    bindingSlots: targetBindings.bindingSlots,
    deployableEnvironmentsQuery,
    deploymentOptions: deploymentOptionsResult.deploymentOptions,
    deploymentOptionsQuery: deploymentOptionsResult.deploymentOptionsQuery,
    envVarSlots: targetEnvVars.envVarSlots,
    envVarValues,
    isBindingLoading,
    isEnvironmentError: deployableEnvironmentsQuery.isError,
    isEnvironmentLoading,
    requiredBindingsReady: targetBindings.requiredBindingsReady,
    requiredEnvVarsReady: targetEnvVars.requiredEnvVarsReady,
    selectedEnvironment,
    selectedEnvironmentId,
    shouldLoadDeploymentTarget,
  }
}
