'use client'

import { useAtomValue } from 'jotai'
import { useDeploymentTargetBindings } from '../../models/deployment-target/bindings'
import { useDeploymentTargetEnvVars } from '../../models/deployment-target/env-vars'
import { useTargetStepSourceSnapshot } from '../../models/source'
import { useDeploymentTargetEnvironment } from '../../queries/target-environments'
import { useDeploymentOptionsQuery } from '../../queries/target-options'
import { useDeploymentTargetQueryInputs } from '../../queries/target-state'
import { unsupportedDslNodesAtom } from '../../state/unsupported-dsl-atoms'

function useTargetStepQueryInputs() {
  // Keep target review data owned by each section instead of rebuilding a page-wide view model.
  const { effectiveSelectedApp } = useTargetStepSourceSnapshot()
  const targetQueryInputs = useDeploymentTargetQueryInputs({
    effectiveSelectedApp,
    shouldResolveDeploymentTarget: true,
  })

  return {
    effectiveSelectedApp,
    ...targetQueryInputs,
  }
}

export function useTargetEnvironmentSectionData() {
  const { queryGate } = useTargetStepQueryInputs()
  const targetEnvironment = useDeploymentTargetEnvironment({
    shouldLoadDeploymentTarget: queryGate.shouldLoadDeploymentTarget,
  })

  return {
    deployableEnvironmentsQuery: targetEnvironment.deployableEnvironmentsQuery,
    effectiveSelectedEnvironmentId: targetEnvironment.effectiveSelectedEnvironmentId,
    environments: targetEnvironment.environments,
    isEnvironmentLoading: targetEnvironment.isEnvironmentLoading,
    onSelectEnvironment: targetEnvironment.onSelectEnvironment,
  }
}

export function useTargetBindingSectionData() {
  const unsupportedDslNodes = useAtomValue(unsupportedDslNodesAtom)
  const {
    dslState,
    effectiveSelectedApp,
    method,
    queryGate,
  } = useTargetStepQueryInputs()
  const deploymentOptionsState = useDeploymentOptionsQuery({
    dslState,
    effectiveSelectedApp,
    method,
    queryGate,
  })
  const targetBindings = useDeploymentTargetBindings({
    credentialSlots: deploymentOptionsState.deploymentOptions?.credentialSlots,
    shouldLoadDeploymentTarget: queryGate.shouldLoadDeploymentTarget,
  })
  const isBindingLoading = queryGate.shouldLoadDeploymentTarget
    && (deploymentOptionsState.deploymentOptionsQuery.isLoading || (deploymentOptionsState.deploymentOptionsQuery.isFetching && !deploymentOptionsState.deploymentOptionsQuery.data))
  const isBindingError = deploymentOptionsState.deploymentOptionsQuery.isError

  return {
    bindingSelections: targetBindings.bindingSelections,
    bindingSlots: targetBindings.bindingSlots,
    isBindingError,
    isBindingLoading,
    onSelectBinding: targetBindings.onSelectBinding,
    shouldRender: !(isBindingError && unsupportedDslNodes.length > 0),
  }
}

export function useTargetEnvVarSectionData() {
  const {
    dslContent,
    dslState,
    effectiveSelectedApp,
    method,
    queryGate,
  } = useTargetStepQueryInputs()
  const deploymentOptionsState = useDeploymentOptionsQuery({
    dslState,
    effectiveSelectedApp,
    method,
    queryGate,
    syncUnsupportedDslNodes: false,
  })
  const targetEnvVars = useDeploymentTargetEnvVars({
    dslContent,
    method,
    shouldLoadDeploymentTarget: queryGate.shouldLoadDeploymentTarget,
    slots: deploymentOptionsState.deploymentOptions?.envVarSlots,
  })
  const isBindingLoading = queryGate.shouldLoadDeploymentTarget
    && (deploymentOptionsState.deploymentOptionsQuery.isLoading || (deploymentOptionsState.deploymentOptionsQuery.isFetching && !deploymentOptionsState.deploymentOptionsQuery.data))

  return {
    envVarSlots: targetEnvVars.envVarSlots,
    envVarValues: targetEnvVars.envVarValues,
    isBindingError: deploymentOptionsState.deploymentOptionsQuery.isError,
    isBindingLoading,
    onSetEnvVar: targetEnvVars.onSetEnvVar,
  }
}

export function useTargetUnsupportedDslSectionData() {
  const unsupportedDslNodes = useAtomValue(unsupportedDslNodesAtom)

  return {
    hasUnsupportedDslNodes: unsupportedDslNodes.length > 0,
    unsupportedDslNodes,
  }
}
