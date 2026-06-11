'use client'

import { useSetAtom } from 'jotai'
import { useEffect } from 'react'
import { unsupportedDslNodeError } from '@/features/deployments/error'
import { useDeploymentTargetQueryGate } from '../../../models/deployment-target/query-gate'
import { useDeploymentOptionsQuery } from '../../../queries/target-options'
import { setDeploymentOptionsUnsupportedDslNodesAtom } from '../../../state/unsupported-dsl-atoms'

export function useDeploymentOptionsUnsupportedDslNodeSync() {
  const {
    dslState,
    effectiveSelectedApp,
    method,
    queryGate,
  } = useDeploymentTargetQueryGate()
  const setDeploymentOptionsUnsupportedDslNodes = useSetAtom(setDeploymentOptionsUnsupportedDslNodesAtom)
  const deploymentOptionsQuery = useDeploymentOptionsQuery({
    dslState,
    effectiveSelectedApp,
    method,
    queryGate,
  }).deploymentOptionsQuery

  useEffect(() => {
    let cancelled = false

    if (!queryGate.shouldLoadDeploymentTarget)
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
    queryGate.shouldLoadDeploymentTarget,
    setDeploymentOptionsUnsupportedDslNodes,
  ])
}
