'use client'

import { useAtomValue } from 'jotai'
import { createDeploymentTargetEnvVars } from '../../../models/deployment-target/env-vars'
import { useDeploymentTargetQueryGate } from '../../../models/deployment-target/query-gate'
import { useDeploymentOptionsQuery } from '../../../queries/target-options'
import { dslContentAtom } from '../../../state/dsl-atoms'
import {
  envVarValuesAtom,
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

export function useTargetEnvVarIsBindingError() {
  return useDeploymentOptionsForTargetEnvVars().deploymentOptionsQuery.isError
}

export function useTargetEnvVarIsBindingLoading() {
  const { queryGate } = useDeploymentTargetQueryGate()
  const deploymentOptionsQuery = useDeploymentOptionsForTargetEnvVars().deploymentOptionsQuery

  return queryGate.shouldLoadDeploymentTarget
    && (deploymentOptionsQuery.isLoading || (deploymentOptionsQuery.isFetching && !deploymentOptionsQuery.data))
}
