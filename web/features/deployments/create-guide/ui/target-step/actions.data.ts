'use client'

import { useAtomValue } from 'jotai'
import { createDeploymentTargetBindings } from '../../models/deployment-target/bindings'
import { createDeploymentTargetEnvVars } from '../../models/deployment-target/env-vars'
import { createDeploymentTargetEnvironment } from '../../models/deployment-target/environment'
import { useDeploymentTargetQueryGate } from '../../models/deployment-target/query-gate'
import { useSubmittedReleaseFieldsStatus } from '../../models/release'
import { useSelectedSourceStatus } from '../../models/source'
import { useDeployableEnvironmentsQuery } from '../../queries/target-environments'
import { useDeploymentOptionsQuery } from '../../queries/target-options'
import { dslContentAtom } from '../../state/dsl-atoms'
import {
  envVarValuesAtom,
  manualBindingSelectionsAtom,
  selectedEnvironmentIdAtom,
} from '../../state/target-atoms'
import {
  unsupportedDslNodesAtom,
} from '../../state/unsupported-dsl-atoms'
import { useCreateDeploymentSubmission } from '../../submission'

function useDeploymentOptionsForTargetActions() {
  const {
    dslState,
    effectiveSelectedApp,
    method,
    queryGate,
  } = useDeploymentTargetQueryGate()

  return useDeploymentOptionsQuery({
    dslState,
    effectiveSelectedApp,
    method,
    queryGate,
  })
}

function useTargetSubmittedReleaseReady(isSourceReady: boolean) {
  const releaseFields = useSubmittedReleaseFieldsStatus()

  return Boolean(
    isSourceReady
    && releaseFields.hasInstanceName
    && releaseFields.hasReleaseName,
  )
}

export function useTargetCanDeploy() {
  const source = useSelectedSourceStatus()
  const dslContent = useAtomValue(dslContentAtom)
  const unsupportedDslNodes = useAtomValue(unsupportedDslNodesAtom)
  const manualBindingSelections = useAtomValue(manualBindingSelectionsAtom)
  const envVarValues = useAtomValue(envVarValuesAtom)
  const selectedEnvironmentId = useAtomValue(selectedEnvironmentIdAtom)
  const { method, queryGate } = useDeploymentTargetQueryGate()
  const deploymentOptionsResult = useDeploymentOptionsForTargetActions()
  const deployableEnvironmentsQuery = useDeployableEnvironmentsQuery(queryGate.shouldLoadDeploymentTarget)
  const environments = queryGate.shouldLoadDeploymentTarget
    ? deployableEnvironmentsQuery.data?.data ?? []
    : []
  const targetEnvironment = createDeploymentTargetEnvironment({
    environments,
    selectedEnvironmentId,
  })
  const targetBindings = createDeploymentTargetBindings({
    credentialSlots: deploymentOptionsResult.deploymentOptions?.credentialSlots,
    manualBindingSelections,
    shouldLoadDeploymentTarget: queryGate.shouldLoadDeploymentTarget,
  })
  const targetEnvVars = createDeploymentTargetEnvVars({
    dslContent,
    envVarValues,
    method,
    shouldLoadDeploymentTarget: queryGate.shouldLoadDeploymentTarget,
    slots: deploymentOptionsResult.deploymentOptions?.envVarSlots,
  })
  const submittedReleaseReady = useTargetSubmittedReleaseReady(source.isReady)
  const deploymentTargetReady = queryGate.shouldLoadDeploymentTarget
    && !(deployableEnvironmentsQuery.isLoading || (deployableEnvironmentsQuery.isFetching && !deployableEnvironmentsQuery.data))
    && !deployableEnvironmentsQuery.isError
    && !(deploymentOptionsResult.deploymentOptionsQuery.isLoading || (deploymentOptionsResult.deploymentOptionsQuery.isFetching && !deploymentOptionsResult.deploymentOptionsQuery.data))
    && !deploymentOptionsResult.deploymentOptionsQuery.isError
    && unsupportedDslNodes.length === 0

  return Boolean(
    targetEnvironment.selectedEnvironment?.id
    && deploymentTargetReady
    && targetBindings.requiredBindingsReady
    && targetEnvVars.requiredEnvVarsReady
    && submittedReleaseReady,
  )
}

export function useTargetCanSkipDeployment() {
  const source = useSelectedSourceStatus()
  const unsupportedDslNodes = useAtomValue(unsupportedDslNodesAtom)
  const deploymentOptionsResult = useDeploymentOptionsForTargetActions()
  const submittedReleaseReady = useTargetSubmittedReleaseReady(source.isReady)

  return Boolean(
    submittedReleaseReady
    && !deploymentOptionsResult.deploymentOptionsQuery.isError
    && unsupportedDslNodes.length === 0,
  )
}

export function useTargetDeployAction() {
  const source = useSelectedSourceStatus()
  const dslContent = useAtomValue(dslContentAtom)
  const manualBindingSelections = useAtomValue(manualBindingSelectionsAtom)
  const envVarValues = useAtomValue(envVarValuesAtom)
  const selectedEnvironmentId = useAtomValue(selectedEnvironmentIdAtom)
  const { method, queryGate } = useDeploymentTargetQueryGate()
  const deploymentOptionsResult = useDeploymentOptionsForTargetActions()
  const deployableEnvironmentsQuery = useDeployableEnvironmentsQuery(queryGate.shouldLoadDeploymentTarget)
  const environments = queryGate.shouldLoadDeploymentTarget
    ? deployableEnvironmentsQuery.data?.data ?? []
    : []
  const targetEnvironment = createDeploymentTargetEnvironment({
    environments,
    selectedEnvironmentId,
  })
  const targetBindings = createDeploymentTargetBindings({
    credentialSlots: deploymentOptionsResult.deploymentOptions?.credentialSlots,
    manualBindingSelections,
    shouldLoadDeploymentTarget: queryGate.shouldLoadDeploymentTarget,
  })
  const targetEnvVars = createDeploymentTargetEnvVars({
    dslContent,
    envVarValues,
    method,
    shouldLoadDeploymentTarget: queryGate.shouldLoadDeploymentTarget,
    slots: deploymentOptionsResult.deploymentOptions?.envVarSlots,
  })
  const submittedReleaseReady = useTargetSubmittedReleaseReady(source.isReady)
  const { createDeploymentAndRelease } = useCreateDeploymentSubmission({
    effectiveSelectedApp: source.effectiveSelectedApp,
    hasInstanceNameConflict: false,
    isInitialReleaseReady: submittedReleaseReady,
    targetSubmissionState: {
      bindingSelections: targetBindings.bindingSelections,
      bindingSlots: targetBindings.bindingSlots,
      deployableEnvironmentsQuery,
      deploymentOptions: deploymentOptionsResult.deploymentOptions,
      envVarSlots: targetEnvVars.envVarSlots,
      envVarValues,
      requiredEnvVarsReady: targetEnvVars.requiredEnvVarsReady,
      selectedEnvironment: targetEnvironment.selectedEnvironment,
      selectedEnvironmentId,
    },
  })

  async function handleDeploy() {
    await createDeploymentAndRelease({ deployToEnvironment: true })
  }

  return handleDeploy
}

export function useTargetSkipDeploymentAction(canSkipDeployment: boolean) {
  const source = useSelectedSourceStatus()
  const dslContent = useAtomValue(dslContentAtom)
  const manualBindingSelections = useAtomValue(manualBindingSelectionsAtom)
  const envVarValues = useAtomValue(envVarValuesAtom)
  const selectedEnvironmentId = useAtomValue(selectedEnvironmentIdAtom)
  const { method, queryGate } = useDeploymentTargetQueryGate()
  const deploymentOptionsResult = useDeploymentOptionsForTargetActions()
  const deployableEnvironmentsQuery = useDeployableEnvironmentsQuery(queryGate.shouldLoadDeploymentTarget)
  const environments = queryGate.shouldLoadDeploymentTarget
    ? deployableEnvironmentsQuery.data?.data ?? []
    : []
  const targetEnvironment = createDeploymentTargetEnvironment({
    environments,
    selectedEnvironmentId,
  })
  const targetBindings = createDeploymentTargetBindings({
    credentialSlots: deploymentOptionsResult.deploymentOptions?.credentialSlots,
    manualBindingSelections,
    shouldLoadDeploymentTarget: queryGate.shouldLoadDeploymentTarget,
  })
  const targetEnvVars = createDeploymentTargetEnvVars({
    dslContent,
    envVarValues,
    method,
    shouldLoadDeploymentTarget: queryGate.shouldLoadDeploymentTarget,
    slots: deploymentOptionsResult.deploymentOptions?.envVarSlots,
  })
  const submittedReleaseReady = useTargetSubmittedReleaseReady(source.isReady)
  const { createDeploymentAndRelease } = useCreateDeploymentSubmission({
    effectiveSelectedApp: source.effectiveSelectedApp,
    hasInstanceNameConflict: false,
    isInitialReleaseReady: submittedReleaseReady,
    targetSubmissionState: {
      bindingSelections: targetBindings.bindingSelections,
      bindingSlots: targetBindings.bindingSlots,
      deployableEnvironmentsQuery,
      deploymentOptions: deploymentOptionsResult.deploymentOptions,
      envVarSlots: targetEnvVars.envVarSlots,
      envVarValues,
      requiredEnvVarsReady: targetEnvVars.requiredEnvVarsReady,
      selectedEnvironment: targetEnvironment.selectedEnvironment,
      selectedEnvironmentId,
    },
  })

  async function handleSkipDeployment() {
    if (!canSkipDeployment)
      return

    await createDeploymentAndRelease({ deployToEnvironment: false })
  }

  return handleSkipDeployment
}
