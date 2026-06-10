'use client'

import { useQuery } from '@tanstack/react-query'
import { consoleQuery } from '@/service/client'

export function useDeployableEnvironmentsQuery(shouldLoadDeploymentTarget: boolean) {
  return useQuery(consoleQuery.enterprise.environmentService.listDeployableEnvironments.queryOptions({
    input: {
      query: {},
    },
    enabled: shouldLoadDeploymentTarget,
  }))
}
