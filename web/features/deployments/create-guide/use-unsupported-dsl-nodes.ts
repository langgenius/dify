'use client'

import type { UnsupportedDslNode } from '../error'
import { useEffect, useState } from 'react'
import { unsupportedDslNodeError } from '../error'

export function useUnsupportedDslNodesFromError({
  error,
  isError,
}: {
  error: unknown
  isError: boolean
}) {
  const [unsupportedDslNodes, setUnsupportedDslNodes] = useState<UnsupportedDslNode[]>([])

  useEffect(() => {
    let cancelled = false

    if (!isError)
      return

    void unsupportedDslNodeError(error).then((unsupportedError) => {
      if (cancelled)
        return

      setUnsupportedDslNodes(unsupportedError?.nodes ?? [])
    })

    return () => {
      cancelled = true
    }
  }, [error, isError])

  return {
    clearUnsupportedDslNodes: () => setUnsupportedDslNodes([]),
    unsupportedDslNodes,
  }
}
