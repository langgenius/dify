'use client'

import type {
  EnvVarValueSelection,
} from '@/features/deployments/components/env-var-bindings'
import { useAtomValue, useSetAtom } from 'jotai'
import { createDeploymentTargetEnvVars } from '../../../models/deployment-target/env-vars'
import { useDeploymentTargetQueryGate } from '../../../models/deployment-target/query-gate'
import { useDeploymentOptionsQuery } from '../../../queries/target-options'
import { dslContentAtom } from '../../../state/dsl-atoms'
import {
  envVarValuesAtom,
  setEnvVarAtom,
} from '../../../state/target-atoms'

function useDeploymentOptionsForTargetEnvVars() {
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

export function useTargetEnvVarSlots() {
  const dslContent = useAtomValue(dslContentAtom)
  const envVarValues = useAtomValue(envVarValuesAtom)
  const { method, queryGate } = useDeploymentTargetQueryGate()
  const deploymentOptionsResult = useDeploymentOptionsForTargetEnvVars()

  return createDeploymentTargetEnvVars({
    dslContent,
    envVarValues,
    method,
    shouldLoadDeploymentTarget: queryGate.shouldLoadDeploymentTarget,
    slots: deploymentOptionsResult.deploymentOptions?.envVarSlots,
  }).envVarSlots
}

export function useTargetEnvVarValues() {
  return useAtomValue(envVarValuesAtom)
}

export function useTargetEnvVarIsBindingError() {
  return useDeploymentOptionsForTargetEnvVars().deploymentOptionsQuery.isError
}

export function useTargetEnvVarIsBindingLoading() {
  const { queryGate } = useDeploymentTargetQueryGate()
  const deploymentOptionsQuery = useDeploymentOptionsForTargetEnvVars().deploymentOptionsQuery

  return queryGate.shouldLoadDeploymentTarget
    && (deploymentOptionsQuery.isLoading || (deploymentOptionsQuery.isFetching && !deploymentOptionsQuery.data))
}

export function useTargetEnvVarChangeAction() {
  const setEnvVar = useSetAtom(setEnvVarAtom)

  return (key: string, value: EnvVarValueSelection) => setEnvVar({ key, value })
}
