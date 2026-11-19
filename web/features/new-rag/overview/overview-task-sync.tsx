'use client'

import { useAtomValueRawSync, useSetAtom } from 'jotai'
import { useEffect } from 'react'
import {
  overviewHasActiveTasksAtom,
  overviewTerminalTasksVersionAtom,
  reconcileOverviewAfterTasksAtom,
  resumeOverviewPollingAtom,
} from './state'

/** Reconciles completed tasks and restarts overview polling when work begins. */
export function OverviewTaskSync() {
  const terminalVersion = useAtomValueRawSync(overviewTerminalTasksVersionAtom)
  const hasActiveTasks = useAtomValueRawSync(overviewHasActiveTasksAtom)
  const reconcile = useSetAtom(reconcileOverviewAfterTasksAtom)
  const resumePolling = useSetAtom(resumeOverviewPollingAtom)
  useEffect(() => {
    if (terminalVersion) void reconcile()
  }, [terminalVersion, reconcile])
  useEffect(() => {
    if (hasActiveTasks) resumePolling()
  }, [hasActiveTasks, resumePolling])
  return null
}
