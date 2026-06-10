'use client'

import { useQuery } from '@tanstack/react-query'
import { useAtomValue, useSetAtom } from 'jotai'
import { environmentMatchesIdentifier } from '@/features/deployments/environment'
import { consoleQuery } from '@/service/client'
import {
  selectedEnvironmentIdAtom,
  selectEnvironmentAtom,
} from '../state/target-atoms'

export function useDeployableEnvironmentsQuery(shouldLoadDeploymentTarget: boolean) {
  return useQuery(consoleQuery.enterprise.environmentService.listDeployableEnvironments.queryOptions({
    input: {
      query: {},
    },
    enabled: shouldLoadDeploymentTarget,
  }))
}

export function useDeploymentTargetEnvironment({
  shouldLoadDeploymentTarget,
}: {
  shouldLoadDeploymentTarget: boolean
}) {
  const selectedEnvironmentId = useAtomValue(selectedEnvironmentIdAtom)
  const selectEnvironment = useSetAtom(selectEnvironmentAtom)
  const deployableEnvironmentsQuery = useDeployableEnvironmentsQuery(shouldLoadDeploymentTarget)
  const environments = shouldLoadDeploymentTarget
    ? deployableEnvironmentsQuery.data?.data ?? []
    : []
  const effectiveSelectedEnvironmentId = selectedEnvironmentId || environments[0]?.id
  const selectedEnvironment = effectiveSelectedEnvironmentId
    ? environments.find(env => environmentMatchesIdentifier(env, effectiveSelectedEnvironmentId))
    : undefined
  const isEnvironmentLoading = shouldLoadDeploymentTarget
    && (deployableEnvironmentsQuery.isLoading || (deployableEnvironmentsQuery.isFetching && !deployableEnvironmentsQuery.data))

  return {
    deployableEnvironmentsQuery,
    effectiveSelectedEnvironmentId,
    environments,
    isEnvironmentLoading,
    onSelectEnvironment: selectEnvironment,
    selectedEnvironment,
    selectedEnvironmentId,
  }
}
