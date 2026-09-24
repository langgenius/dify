'use client'

import type { DifyBuilderProgressEventData } from '@dify/contracts/api/console/dify-builder/types.gen'
import type { DifyBuilderExecutionProgress } from '../types'
import { useSetAtom, useStore } from 'jotai'
import { useCallback, useEffect, useMemo } from 'react'
import {
  difyBuilderActiveCommandAtom,
  difyBuilderActiveSessionIdAtom,
  difyBuilderExecutionProgressAtom,
  difyBuilderSessionViewAtom,
} from './state'

const reduceExecutionProgress = (
  current: DifyBuilderExecutionProgress | null,
  progress: DifyBuilderProgressEventData,
): DifyBuilderExecutionProgress => {
  const continuesOperation =
    current?.sessionId === progress.session_id &&
    current.operationId === progress.operation_id &&
    current.atVersion === progress.at_version
  const activities = continuesOperation ? [...(current.execution.activities ?? [])] : []

  const activity = progress.activity
  if (activity) {
    const activityIndex = activities.findIndex(
      (currentActivity) => currentActivity.id === activity.id,
    )
    if (activityIndex === -1) activities.push(activity)
    else activities[activityIndex] = activity
  }

  return {
    sessionId: progress.session_id,
    operationId: progress.operation_id,
    atVersion: progress.at_version,
    revision: progress.revision,
    execution: {
      status: progress.status,
      activities,
    },
  }
}

/** Reduces ordered activity deltas separately from the durable SessionView. */
export const useDifyBuilderExecutionProgress = () => {
  const store = useStore()
  const setExecutionProgress = useSetAtom(difyBuilderExecutionProgressAtom)

  const clear = useCallback(() => {
    setExecutionProgress(null)
  }, [setExecutionProgress])

  const clearThroughVersion = useCallback(
    (sessionId: string, version: number) => {
      setExecutionProgress((current) =>
        current?.sessionId === sessionId && current.atVersion <= version ? null : current,
      )
    },
    [setExecutionProgress],
  )

  const enqueue = useCallback(
    (progress: DifyBuilderProgressEventData) => {
      const view = store.get(difyBuilderSessionViewAtom)
      const activeCommand = store.get(difyBuilderActiveCommandAtom)
      if (
        store.get(difyBuilderActiveSessionIdAtom) !== progress.session_id ||
        (view?.session_id !== progress.session_id &&
          activeCommand?.session_id !== progress.session_id) ||
        (view?.session_id === progress.session_id && view.version >= progress.at_version)
      )
        return

      setExecutionProgress((current) => {
        if (current?.sessionId === progress.session_id && current.atVersion > progress.at_version)
          return current
        if (current?.operationId === progress.operation_id && current.revision >= progress.revision)
          return current
        return reduceExecutionProgress(current, progress)
      })
    },
    [setExecutionProgress, store],
  )

  useEffect(() => clear, [clear])

  return useMemo(
    () => ({ clear, clearThroughVersion, enqueue }),
    [clear, clearThroughVersion, enqueue],
  )
}
