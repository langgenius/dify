'use client'

import type { UnsupportedDslNode } from '@/features/deployments/error'
import { useEffect } from 'react'
import { unsupportedDslNodeError } from '@/features/deployments/error'

export function useDeploymentOptionsUnsupportedDslNodeSync({
  enabled,
  error,
  isError,
  setDeploymentOptionsUnsupportedDslNodes,
}: {
  enabled: boolean
  error: unknown
  isError: boolean
  setDeploymentOptionsUnsupportedDslNodes: (nodes: UnsupportedDslNode[]) => void
}) {
  useEffect(() => {
    let cancelled = false

    if (!enabled)
      return

    if (!isError) {
      setDeploymentOptionsUnsupportedDslNodes([])
      return
    }

    void unsupportedDslNodeError(error).then((unsupportedError) => {
      if (cancelled)
        return

      setDeploymentOptionsUnsupportedDslNodes(unsupportedError?.nodes ?? [])
    })

    return () => {
      cancelled = true
    }
  }, [enabled, error, isError, setDeploymentOptionsUnsupportedDslNodes])
}
