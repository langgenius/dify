'use client'

import { useAtomValue } from 'jotai'
import { environmentMatchesIdentifier } from '@/features/deployments/environment'
import { createDeploymentTargetEnvironment } from '../../../models/deployment-target/environment'
import { useDeploymentTargetQueryGate } from '../../../models/deployment-target/query-gate'
import { useDeployableEnvironmentsQuery } from '../../../queries/target-environments'
import {
  selectedEnvironmentIdAtom,
} from '../../../state/target-atoms'

export function useTargetEnvironments() {
  const { queryGate } = useDeploymentTargetQueryGate()
  const deployableEnvironmentsQuery = useDeployableEnvironmentsQuery(queryGate.shouldLoadDeploymentTarget)

  return queryGate.shouldLoadDeploymentTarget
    ? deployableEnvironmentsQuery.data?.data ?? []
    : []
}

export function useTargetEffectiveSelectedEnvironmentId() {
  const environments = useTargetEnvironments()
  const selectedEnvironmentId = useAtomValue(selectedEnvironmentIdAtom)

  return createDeploymentTargetEnvironment({
    environments,
    selectedEnvironmentId,
  }).effectiveSelectedEnvironmentId
}

export function useTargetEnvironmentIsError() {
  const { queryGate } = useDeploymentTargetQueryGate()
  const deployableEnvironmentsQuery = useDeployableEnvironmentsQuery(queryGate.shouldLoadDeploymentTarget)

  return deployableEnvironmentsQuery.isError
}

export function useTargetEnvironmentIsLoading() {
  const { queryGate } = useDeploymentTargetQueryGate()
  const deployableEnvironmentsQuery = useDeployableEnvironmentsQuery(queryGate.shouldLoadDeploymentTarget)

  return queryGate.shouldLoadDeploymentTarget
    && (deployableEnvironmentsQuery.isLoading || (deployableEnvironmentsQuery.isFetching && !deployableEnvironmentsQuery.data))
}

export function useTargetEnvironmentIsSelected(environmentId: string) {
  const environments = useTargetEnvironments()
  const effectiveSelectedEnvironmentId = useTargetEffectiveSelectedEnvironmentId()
  const environment = environments.find(env => env.id === environmentId)

  return Boolean(environment && effectiveSelectedEnvironmentId && environmentMatchesIdentifier(environment, effectiveSelectedEnvironmentId))
}
