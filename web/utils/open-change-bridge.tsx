'use client'

import type { FC } from 'react'
import { useEffect, useRef } from 'react'

/** Notifies parent when a controlled open flag changes (skips the initial render). */
export const OpenChangeBridge: FC<{ open: boolean, onOpenChange?: (open: boolean) => void }> = ({
  open,
  onOpenChange,
}) => {
  const prevOpen = useRef<boolean | undefined>(undefined)
  useEffect(() => {
    if (prevOpen.current === undefined) {
      prevOpen.current = open
      return
    }
    if (prevOpen.current !== open) {
      prevOpen.current = open
      onOpenChange?.(open)
    }
  }, [open, onOpenChange])
  return null
}
