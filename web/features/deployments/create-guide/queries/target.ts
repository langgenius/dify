'use client'

import type { CredentialSlot } from '@dify/contracts/enterprise/types.gen'
import type { useDeployableEnvironmentsQuery } from './target-environments'
import type {
  EnvVarBindingSlot,
  EnvVarValues,
} from '@/features/deployments/components/env-var-bindings'
import type { RuntimeCredentialBindingSelections } from '@/features/deployments/components/runtime-credential-bindings-utils'
import type { App } from '@/types/app'
import { useDeploymentTargetBindings } from '../models/deployment-target/bindings'
import { useDeploymentTargetEnvVars } from '../models/deployment-target/env-vars'
import {
  useDeploymentTargetEnvironment,
} from './target-environments'
import { useDeploymentOptionsQuery } from './target-options'
import { useDeploymentTargetQueryInputs } from './target-state'

function useDeploymentTargetActionData({
  effectiveSelectedApp,
  shouldResolveDeploymentTarget,
}: {
  effectiveSelectedApp?: App
  shouldResolveDeploymentTarget: boolean
}) {
  const {
    dslContent,
    dslState,
    method,
    queryGate,
  } = useDeploymentTargetQueryInputs({
    effectiveSelectedApp,
    shouldResolveDeploymentTarget,
  })
  const targetEnvironment = useDeploymentTargetEnvironment({
    shouldLoadDeploymentTarget: queryGate.shouldLoadDeploymentTarget,
  })
  const deploymentOptionsState = useDeploymentOptionsQuery({
    dslState,
    effectiveSelectedApp,
    method,
    queryGate,
    syncUnsupportedDslNodes: false,
  })
  const targetBindings = useDeploymentTargetBindings({
    credentialSlots: deploymentOptionsState.deploymentOptions?.credentialSlots,
    shouldLoadDeploymentTarget: queryGate.shouldLoadDeploymentTarget,
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
    deploymentOptionsState,
    isBindingLoading,
    shouldLoadDeploymentTarget: queryGate.shouldLoadDeploymentTarget,
    targetBindings,
    targetEnvironment,
    targetEnvVars,
  }
}

type DeploymentTargetOptions = ReturnType<typeof useDeploymentOptionsQuery>['deploymentOptions']
type DeploymentOptionsQuery = ReturnType<typeof useDeploymentOptionsQuery>['deploymentOptionsQuery']
type DeploymentTargetSelectedEnvironment = ReturnType<typeof useDeploymentTargetEnvironment>['selectedEnvironment']

export type DeploymentTargetSubmissionState = {
  bindingSelections: RuntimeCredentialBindingSelections
  bindingSlots: CredentialSlot[]
  deployableEnvironmentsQuery: ReturnType<typeof useDeployableEnvironmentsQuery>
  deploymentOptions: DeploymentTargetOptions
  envVarSlots: EnvVarBindingSlot[]
  envVarValues: EnvVarValues
  requiredEnvVarsReady: boolean
  selectedEnvironment: DeploymentTargetSelectedEnvironment
  selectedEnvironmentId: string
}

export type DeploymentTargetActionState = DeploymentTargetSubmissionState & {
  deploymentOptionsQuery: DeploymentOptionsQuery
  isBindingLoading: boolean
  isEnvironmentLoading: boolean
  requiredBindingsReady: boolean
  shouldLoadDeploymentTarget: boolean
}

export function useDeploymentTargetActionSnapshot(args: {
  effectiveSelectedApp?: App
  shouldResolveDeploymentTarget: boolean
}): DeploymentTargetActionState {
  const {
    deploymentOptionsState,
    isBindingLoading,
    shouldLoadDeploymentTarget,
    targetBindings,
    targetEnvironment,
    targetEnvVars,
  } = useDeploymentTargetActionData(args)

  return {
    bindingSelections: targetBindings.bindingSelections,
    bindingSlots: targetBindings.bindingSlots,
    deployableEnvironmentsQuery: targetEnvironment.deployableEnvironmentsQuery,
    deploymentOptions: deploymentOptionsState.deploymentOptions,
    deploymentOptionsQuery: deploymentOptionsState.deploymentOptionsQuery,
    envVarSlots: targetEnvVars.envVarSlots,
    envVarValues: targetEnvVars.envVarValues,
    isBindingLoading,
    isEnvironmentLoading: targetEnvironment.isEnvironmentLoading,
    requiredBindingsReady: targetBindings.requiredBindingsReady,
    requiredEnvVarsReady: targetEnvVars.requiredEnvVarsReady,
    selectedEnvironment: targetEnvironment.selectedEnvironment,
    selectedEnvironmentId: targetEnvironment.selectedEnvironmentId,
    shouldLoadDeploymentTarget,
  }
}
