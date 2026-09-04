'use client'

import type { ProgressEventData } from '@dify/contracts/api/console/dify-builder/types.gen'
import type { DifyBuilderExecutionProgress } from '../types'
import { useSetAtom, useStore } from 'jotai'
import { useCallback, useEffect, useMemo } from 'react'
import {
  difyBuilderActiveSessionIdAtom,
  difyBuilderExecutionProgressAtom,
  difyBuilderSessionViewAtom,
} from './state'

const toExecutionProgress = (progress: ProgressEventData): DifyBuilderExecutionProgress => ({
  sessionId: progress.session_id,
  operationId: progress.operation_id,
  stageId: progress.stage_id,
  atVersion: progress.at_version,
  revision: progress.revision,
  execution: {
    ...progress.execution,
    activities: [...(progress.execution.activities ?? [])],
  },
})

/** Owns low-frequency, replaceable execution snapshots separately from SessionView. */
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
    (progress: ProgressEventData) => {
      const view = store.get(difyBuilderSessionViewAtom)
      if (
        store.get(difyBuilderActiveSessionIdAtom) !== progress.session_id ||
        view?.session_id !== progress.session_id ||
        view.version >= progress.at_version
      )
        return

      setExecutionProgress((current) => {
        if (current?.sessionId === progress.session_id && current.atVersion > progress.at_version)
          return current
        if (current?.operationId === progress.operation_id && current.revision >= progress.revision)
          return current
        return toExecutionProgress(progress)
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
