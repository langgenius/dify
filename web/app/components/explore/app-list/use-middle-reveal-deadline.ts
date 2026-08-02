'use client'

import { useEffect, useState } from 'react'

const REVEAL_DEADLINE_MS = 5000

export function useRevealDeadline(isPending: boolean) {
  const [hasReachedDeadline, setHasReachedDeadline] = useState(false)

  useEffect(() => {
    if (!isPending || hasReachedDeadline) return

    const timeout = setTimeout(() => {
      setHasReachedDeadline(true)
    }, REVEAL_DEADLINE_MS)

    return () => clearTimeout(timeout)
  }, [hasReachedDeadline, isPending])

  return isPending && !hasReachedDeadline
}

export const useMiddleRevealDeadline = useRevealDeadline
