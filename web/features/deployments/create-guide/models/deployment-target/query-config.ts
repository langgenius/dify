'use client'

import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { consoleQuery } from '@/service/client'
import { deploymentTargetQueryEnabledAtom } from '../../state/deployment-target-query-atoms'
import {
  encodedDslContentAtom,
} from '../../state/dsl-atoms'
import { selectedAppAtom } from '../../state/source-atoms'
import { methodAtom } from '../../state/workflow-atoms'

export function useCreateGuideDeploymentOptionsQuery() {
  const enabled = useAtomValue(deploymentTargetQueryEnabledAtom)
  const method = useAtomValue(methodAtom)
  const encodedDslContent = useAtomValue(encodedDslContentAtom)
  const selectedApp = useAtomValue(selectedAppAtom)
  const deploymentOptionsQueryOptions = method === 'importDsl'
    ? consoleQuery.enterprise.releaseService.getDeploymentOptionsFromDsl.queryOptions({
        input: {
          body: {
            dsl: encodedDslContent,
          },
        },
        enabled,
      })
    : consoleQuery.enterprise.releaseService.getDeploymentOptionsFromSourceApp.queryOptions({
        input: {
          body: {
            sourceAppId: selectedApp?.id ?? '',
          },
        },
        enabled: enabled && Boolean(selectedApp?.id),
      })

  // oRPC encodes input before TanStack can skip work, so keep a valid input shape and gate requests with enabled.
  return useQuery({
    ...deploymentOptionsQueryOptions,
    retry: false,
  })
}
