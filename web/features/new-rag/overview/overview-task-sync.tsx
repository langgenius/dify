'use client'

import { useInfiniteQuery } from '@tanstack/react-query'
import { useAtomValueRawSync, useSetAtom } from 'jotai'
import { useEffect, useRef } from 'react'
import {
  overviewBackgroundTasksOptions,
  overviewKnowledgeSpaceIdAtom,
  overviewTaskPollingState,
  overviewTerminalTasksVersion,
  reconcileOverviewAfterTasksAtom,
  resumeOverviewPollingAtom,
} from './state'

/**
 * Synchronizes task completion with the shared Query cache, independently of empty-state UI.
 * Reads the task list from Query directly: the scoped task atoms can briefly report an older
 * result after a task finishes, which would look like a new task starting.
 */
export function OverviewTaskSync() {
  const knowledgeSpaceId = useAtomValueRawSync(overviewKnowledgeSpaceIdAtom)
  const { data } = useInfiniteQuery({
    ...overviewBackgroundTasksOptions(knowledgeSpaceId),
    select: (result) => {
      const tasks = result.pages.flatMap((page) => page.data)
      return {
        hasActiveTasks: overviewTaskPollingState(tasks).hasActiveTasks,
        terminalVersion: overviewTerminalTasksVersion(tasks),
      }
    },
  })
  const reconcile = useSetAtom(reconcileOverviewAfterTasksAtom)
  const resumePolling = useSetAtom(resumeOverviewPollingAtom)
  const terminalVersion = data?.terminalVersion
  const hasActiveTasks = data?.hasActiveTasks
  // Undefined until the first task list arrives; snapshots keep polling until then.
  const hadActiveTasksRef = useRef<boolean | undefined>(undefined)
  useEffect(() => {
    if (terminalVersion) void reconcile()
  }, [terminalVersion, reconcile])
  useEffect(() => {
    if (hasActiveTasks === undefined) return
    const started = hasActiveTasks && hadActiveTasksRef.current === false
    hadActiveTasksRef.current = hasActiveTasks
    if (started) void resumePolling()
  }, [hasActiveTasks, resumePolling])
  return null
}
