'use client'

import type { DifyBuilderReasoningEventData } from '@dify/contracts/api/console/dify-builder/types.gen'
import type { DifyBuilderReasoning } from '../types'
import { useSetAtom, useStore } from 'jotai'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  difyBuilderActiveCommandAtom,
  difyBuilderActiveSessionIdAtom,
  difyBuilderReasoningAtom,
  difyBuilderSessionViewAtom,
} from './state'

type ScheduledFrame =
  | { id: number; kind: 'animation-frame' }
  | { id: ReturnType<typeof globalThis.setTimeout>; kind: 'timeout' }

const scheduleFrame = (callback: () => void): ScheduledFrame => {
  if (typeof globalThis.requestAnimationFrame === 'function') {
    return {
      id: globalThis.requestAnimationFrame(callback),
      kind: 'animation-frame',
    }
  }
  return {
    id: globalThis.setTimeout(callback, 16),
    kind: 'timeout',
  }
}

const cancelFrame = (frame: ScheduledFrame) => {
  if (frame.kind === 'animation-frame') {
    globalThis.cancelAnimationFrame?.(frame.id)
    return
  }
  globalThis.clearTimeout(frame.id)
}

const toReasoning = (event: DifyBuilderReasoningEventData): DifyBuilderReasoning => ({
  sessionId: event.session_id,
  operationId: event.operation_id,
  atVersion: event.at_version,
  revision: event.revision,
  text: event.delta,
})

const isSameReasoning = (left: DifyBuilderReasoning, right: DifyBuilderReasoning) =>
  left.sessionId === right.sessionId &&
  left.operationId === right.operationId &&
  left.atVersion === right.atVersion

/** Buffers token-frequency reasoning deltas into a small, isolated atom. */
export const useDifyBuilderReasoningBuffer = () => {
  const store = useStore()
  const setReasoning = useSetAtom(difyBuilderReasoningAtom)
  const accumulatedReasoningRef = useRef<DifyBuilderReasoning | null>(null)
  const scheduledFrameRef = useRef<ScheduledFrame | null>(null)

  const flush = useCallback(() => {
    scheduledFrameRef.current = null
    const accumulated = accumulatedReasoningRef.current
    if (!accumulated) return

    const view = store.get(difyBuilderSessionViewAtom)
    const activeCommand = store.get(difyBuilderActiveCommandAtom)
    if (
      store.get(difyBuilderActiveSessionIdAtom) !== accumulated.sessionId ||
      (view?.session_id !== accumulated.sessionId &&
        activeCommand?.session_id !== accumulated.sessionId) ||
      (view?.session_id === accumulated.sessionId && view.version >= accumulated.atVersion) ||
      (activeCommand?.session_id === accumulated.sessionId &&
        activeCommand.version >= accumulated.atVersion)
    )
      return

    setReasoning((current) => {
      if (current && current.atVersion > accumulated.atVersion) return current
      if (
        current &&
        isSameReasoning(current, accumulated) &&
        current.revision >= accumulated.revision
      )
        return current
      return accumulated
    })
  }, [setReasoning, store])

  const accumulate = useCallback((event: DifyBuilderReasoningEventData) => {
    const next = toReasoning(event)
    const current = accumulatedReasoningRef.current
    if (current && isSameReasoning(current, next) && current.revision >= next.revision)
      return current
    if (current && !isSameReasoning(current, next) && current.atVersion > next.atVersion)
      return current
    const accumulated =
      current && isSameReasoning(current, next)
        ? { ...next, text: `${current.text}${next.text}` }
        : next
    accumulatedReasoningRef.current = accumulated
    return accumulated
  }, [])

  const cancelPendingFrame = useCallback(() => {
    if (!scheduledFrameRef.current) return
    cancelFrame(scheduledFrameRef.current)
    scheduledFrameRef.current = null
  }, [])

  const clear = useCallback(() => {
    cancelPendingFrame()
    accumulatedReasoningRef.current = null
    setReasoning(null)
  }, [cancelPendingFrame, setReasoning])

  const clearThroughVersion = useCallback(
    (sessionId: string, version: number) => {
      const accumulated = accumulatedReasoningRef.current
      if (accumulated?.sessionId === sessionId && accumulated.atVersion <= version) {
        cancelPendingFrame()
        accumulatedReasoningRef.current = null
      }
      setReasoning((current) =>
        current?.sessionId === sessionId && current.atVersion <= version ? null : current,
      )
    },
    [cancelPendingFrame, setReasoning],
  )

  const enqueue = useCallback(
    (event: DifyBuilderReasoningEventData) => {
      if (!event.delta) return
      const view = store.get(difyBuilderSessionViewAtom)
      const activeCommand = store.get(difyBuilderActiveCommandAtom)
      if (
        store.get(difyBuilderActiveSessionIdAtom) !== event.session_id ||
        (view?.session_id !== event.session_id && activeCommand?.session_id !== event.session_id) ||
        (view?.session_id === event.session_id && view.version >= event.at_version)
      )
        return

      if (!accumulate(event)) return
      if (!scheduledFrameRef.current) scheduledFrameRef.current = scheduleFrame(flush)
    },
    [accumulate, flush, store],
  )

  const finish = useCallback(
    (sessionId: string, operationId: string, atVersion: number) => {
      const accumulated = accumulatedReasoningRef.current
      if (
        !accumulated ||
        accumulated.sessionId !== sessionId ||
        accumulated.operationId !== operationId ||
        accumulated.atVersion !== atVersion
      )
        return ''
      cancelPendingFrame()
      accumulatedReasoningRef.current = null
      setReasoning((current) => (current && isSameReasoning(current, accumulated) ? null : current))
      return accumulated.text
    },
    [cancelPendingFrame, setReasoning],
  )

  useEffect(() => clear, [clear])

  return useMemo(
    () => ({ clear, clearThroughVersion, enqueue, finish }),
    [clear, clearThroughVersion, enqueue, finish],
  )
}
