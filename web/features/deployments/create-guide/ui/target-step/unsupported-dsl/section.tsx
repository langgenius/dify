'use client'

import { useAtomValue, useSetAtom } from 'jotai'
import { useEffect } from 'react'
import { UnsupportedDslNodesAlert } from '@/features/deployments/components/unsupported-dsl-nodes-alert'
import { unsupportedDslNodeError } from '@/features/deployments/error'
import {
  useCreateGuideDeploymentOptionsQuery,
} from '../../../models/deployment-target/query-config'
import { deploymentTargetQueryEnabledAtom } from '../../../state/deployment-target-query-atoms'
import {
  setDeploymentOptionsUnsupportedDslNodesAtom,
  unsupportedDslNodesAtom,
} from '../../../state/unsupported-dsl-atoms'

export function TargetUnsupportedDslNodesSection() {
  const enabled = useAtomValue(deploymentTargetQueryEnabledAtom)
  const setDeploymentOptionsUnsupportedDslNodes = useSetAtom(setDeploymentOptionsUnsupportedDslNodesAtom)
  const deploymentOptionsQuery = useCreateGuideDeploymentOptionsQuery()
  const unsupportedDslNodes = useAtomValue(unsupportedDslNodesAtom)

  useEffect(() => {
    let cancelled = false

    if (!enabled)
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
    enabled,
  ])

  if (unsupportedDslNodes.length === 0)
    return null

  return <UnsupportedDslNodesAlert nodes={unsupportedDslNodes} />
}
