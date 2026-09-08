'use client'

import { useAtomValue, useSetAtom } from 'jotai'
import { useEffect } from 'react'
import { overviewTerminalTasksVersionAtom, reconcileOverviewAfterTasksAtom } from './state'

/** Synchronizes task completion with the shared Query cache, independently of empty-state UI. */
export function OverviewTaskSync() {
  const terminalVersion = useAtomValue(overviewTerminalTasksVersionAtom)
  const reconcile = useSetAtom(reconcileOverviewAfterTasksAtom)
  useEffect(() => {
    if (terminalVersion) void reconcile()
  }, [terminalVersion, reconcile])
  return null
}
