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
  const { data, isError } = useInfiniteQuery({
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
  const terminalVersionRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (terminalVersion === undefined) {
      // A failed task request stops snapshot polling; count it as an empty list, so finished
      // tasks in the recovered list refresh the snapshots.
      if (isError) terminalVersionRef.current = ''
      return
    }
    // A terminal task seen for the first time may finish after the snapshots stopped polling.
    const changed =
      terminalVersionRef.current !== undefined && terminalVersionRef.current !== terminalVersion
    terminalVersionRef.current = terminalVersion
    if (terminalVersion) void reconcile({ refreshSnapshots: changed })
  }, [terminalVersion, isError, reconcile])
  useEffect(() => {
    if (hasActiveTasks === undefined) {
      // A failed task request stops snapshot polling, so a later active result must resume it.
      if (isError) hadActiveTasksRef.current = false
      return
    }
    const started = hasActiveTasks && hadActiveTasksRef.current === false
    hadActiveTasksRef.current = hasActiveTasks
    if (started) void resumePolling()
  }, [hasActiveTasks, isError, resumePolling])
  return null
}
