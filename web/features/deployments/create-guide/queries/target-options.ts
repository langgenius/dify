'use client'

import type { CreateGuideDslState } from '../state/dsl-derived'
import type { GuideMethod } from '../types'
import type { App } from '@/types/app'
import { useQuery } from '@tanstack/react-query'
import { consoleQuery } from '@/service/client'

type DeploymentTargetQueryGate = {
  shouldLoadDslDeploymentOptions: boolean
  shouldLoadSourceDeploymentOptions: boolean
}

export function useDeploymentOptionsQuery({
  dslState,
  effectiveSelectedApp,
  method,
  queryGate,
}: {
  dslState: CreateGuideDslState
  effectiveSelectedApp?: App
  method: GuideMethod
  queryGate: DeploymentTargetQueryGate
}) {
  // oRPC encodes input before TanStack can skip work, so keep a valid input shape and gate requests with enabled.
  const sourceDeploymentOptionsQuery = useQuery({
    ...consoleQuery.enterprise.releaseService.getDeploymentOptionsFromSourceApp.queryOptions({
      input: {
        body: {
          sourceAppId: effectiveSelectedApp?.id ?? '',
        },
      },
      enabled: queryGate.shouldLoadSourceDeploymentOptions && Boolean(effectiveSelectedApp?.id),
    }),
    retry: false,
  })
  const dslDeploymentOptionsQuery = useQuery({
    ...consoleQuery.enterprise.releaseService.getDeploymentOptionsFromDsl.queryOptions({
      input: {
        body: {
          dsl: dslState.encodedDslContent,
        },
      },
      enabled: queryGate.shouldLoadDslDeploymentOptions,
    }),
    retry: false,
  })
  const deploymentOptionsQuery = method === 'importDsl' ? dslDeploymentOptionsQuery : sourceDeploymentOptionsQuery

  return {
    deploymentOptions: deploymentOptionsQuery.data?.options,
    deploymentOptionsQuery,
  }
}
