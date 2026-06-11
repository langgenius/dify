'use client'

import { useAtomValue } from 'jotai'
import { createDeploymentTargetEnvironment } from '../../../models/deployment-target/environment'
import {
  useCreateGuideDeployableEnvironmentsQuery,
  useCreateGuideDeploymentTargetEnabled,
} from '../../../models/deployment-target/query-config'
import {
  selectedEnvironmentIdAtom,
} from '../../../state/target-atoms'

export function useTargetEnvironments() {
  const shouldLoadDeploymentTarget = useCreateGuideDeploymentTargetEnabled()
  const deployableEnvironmentsQuery = useCreateGuideDeployableEnvironmentsQuery()

  return shouldLoadDeploymentTarget
    ? deployableEnvironmentsQuery.data?.data ?? []
    : []
}

export function useTargetEnvironmentsQuery() {
  return useCreateGuideDeployableEnvironmentsQuery()
}

export function useTargetEffectiveSelectedEnvironmentId() {
  const environments = useTargetEnvironments()
  const selectedEnvironmentId = useAtomValue(selectedEnvironmentIdAtom)

  return createDeploymentTargetEnvironment({
    environments,
    selectedEnvironmentId,
  }).effectiveSelectedEnvironmentId
}
