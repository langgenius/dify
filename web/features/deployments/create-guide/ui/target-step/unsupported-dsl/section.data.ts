'use client'

import { useSetAtom } from 'jotai'
import { useEffect } from 'react'
import { unsupportedDslNodeError } from '@/features/deployments/error'
import {
  useCreateGuideDeploymentOptionsQuery,
  useCreateGuideDeploymentTargetEnabled,
} from '../../../models/deployment-target/query-config'
import { setDeploymentOptionsUnsupportedDslNodesAtom } from '../../../state/unsupported-dsl-atoms'

export function useDeploymentOptionsUnsupportedDslNodeSync() {
  const shouldLoadDeploymentTarget = useCreateGuideDeploymentTargetEnabled()
  const setDeploymentOptionsUnsupportedDslNodes = useSetAtom(setDeploymentOptionsUnsupportedDslNodesAtom)
  const deploymentOptionsQuery = useCreateGuideDeploymentOptionsQuery()

  useEffect(() => {
    let cancelled = false

    if (!shouldLoadDeploymentTarget)
      return

    if (!deploymentOptionsQuery.isError) {
      setDeploymentOptionsUnsupportedDslNodes([])
      return
    }

    void unsupportedDslNodeError(deploymentOptionsQuery.error).then((unsupportedError) => {
      if (!cancelled)
        setDeploymentOptionsUnsupportedDslNodes(unsupportedError?.nodes ?? [])
    })

    return () => {
      cancelled = true
    }
  }, [
    deploymentOptionsQuery.error,
    deploymentOptionsQuery.isError,
    setDeploymentOptionsUnsupportedDslNodes,
    shouldLoadDeploymentTarget,
  ])
}
