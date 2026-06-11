'use client'

import { useAtomValue } from 'jotai'
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

export function useTargetEnvironmentsQuery() {
  const { queryGate } = useDeploymentTargetQueryGate()

  return useDeployableEnvironmentsQuery(queryGate.shouldLoadDeploymentTarget)
}

export function useTargetEffectiveSelectedEnvironmentId() {
  const environments = useTargetEnvironments()
  const selectedEnvironmentId = useAtomValue(selectedEnvironmentIdAtom)

  return createDeploymentTargetEnvironment({
    environments,
    selectedEnvironmentId,
  }).effectiveSelectedEnvironmentId
}
