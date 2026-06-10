'use client'

import type { createDeploymentTargetQueryGate } from '../models/deployment-target/query-gate'
import type { CreateGuideDslState } from '../models/selectors'
import type { GuideMethod } from '../types'
import type { App } from '@/types/app'
import { useQuery } from '@tanstack/react-query'
import { useSetAtom } from 'jotai'
import { consoleQuery } from '@/service/client'
import {
  setDeploymentOptionsUnsupportedDslNodesAtom,
} from '../state/unsupported-dsl-atoms'
import { useDeploymentOptionsUnsupportedDslNodeSync } from './target-unsupported-dsl-node-sync'

type DeploymentTargetQueryGate = ReturnType<typeof createDeploymentTargetQueryGate>

export function useDeploymentOptionsQuery({
  dslState,
  effectiveSelectedApp,
  method,
  queryGate,
  syncUnsupportedDslNodes = true,
}: {
  dslState: CreateGuideDslState
  effectiveSelectedApp?: App
  method: GuideMethod
  queryGate: DeploymentTargetQueryGate
  syncUnsupportedDslNodes?: boolean
}) {
  const setDeploymentOptionsUnsupportedDslNodes = useSetAtom(setDeploymentOptionsUnsupportedDslNodesAtom)

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

  // Multiple UI surfaces can read the same cached options query; only one should mirror parser errors into guide state.
  useDeploymentOptionsUnsupportedDslNodeSync({
    enabled: syncUnsupportedDslNodes,
    error: deploymentOptionsQuery.error,
    isError: deploymentOptionsQuery.isError,
    setDeploymentOptionsUnsupportedDslNodes,
  })

  return {
    deploymentOptions: deploymentOptionsQuery.data?.options,
    deploymentOptionsQuery,
  }
}
