'use client'

import type { GuideMethod, WorkflowSourceApp } from '../types'
import { useQuery } from '@tanstack/react-query'
import { consoleQuery } from '@/service/client'

type DeploymentTargetQueryGate = {
  shouldLoadDslDeploymentOptions: boolean
  shouldLoadSourceDeploymentOptions: boolean
}

export function useDeploymentOptionsQuery({
  encodedDslContent,
  method,
  selectedApp,
  shouldLoadDslDeploymentOptions,
  shouldLoadSourceDeploymentOptions,
}: {
  encodedDslContent: string
  method: GuideMethod
  selectedApp?: WorkflowSourceApp
} & DeploymentTargetQueryGate) {
  // oRPC encodes input before TanStack can skip work, so keep a valid input shape and gate requests with enabled.
  const sourceDeploymentOptionsQuery = useQuery({
    ...consoleQuery.enterprise.releaseService.getDeploymentOptionsFromSourceApp.queryOptions({
      input: {
        body: {
          sourceAppId: selectedApp?.id ?? '',
        },
      },
      enabled: shouldLoadSourceDeploymentOptions && Boolean(selectedApp?.id),
    }),
    retry: false,
  })
  const dslDeploymentOptionsQuery = useQuery({
    ...consoleQuery.enterprise.releaseService.getDeploymentOptionsFromDsl.queryOptions({
      input: {
        body: {
          dsl: encodedDslContent,
        },
      },
      enabled: shouldLoadDslDeploymentOptions,
    }),
    retry: false,
  })

  return method === 'importDsl' ? dslDeploymentOptionsQuery : sourceDeploymentOptionsQuery
}
