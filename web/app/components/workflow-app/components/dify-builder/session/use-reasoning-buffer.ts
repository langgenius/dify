'use client'

import type { ReasoningEventData } from '@dify/contracts/api/console/dify-builder/types.gen'
import type { DifyBuilderReasoning } from '../types'
import { useSetAtom, useStore } from 'jotai'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
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

const toReasoning = (event: ReasoningEventData): DifyBuilderReasoning => ({
  sessionId: event.session_id,
  operationId: event.operation_id,
  stageId: event.stage_id,
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
  const pendingReasoningRef = useRef<DifyBuilderReasoning | null>(null)
  const scheduledFrameRef = useRef<ScheduledFrame | null>(null)

  const flush = useCallback(() => {
    scheduledFrameRef.current = null
    const pending = pendingReasoningRef.current
    pendingReasoningRef.current = null
    if (!pending) return

    const view = store.get(difyBuilderSessionViewAtom)
    if (
      store.get(difyBuilderActiveSessionIdAtom) !== pending.sessionId ||
      view?.session_id !== pending.sessionId ||
      view.version >= pending.atVersion
    )
      return

    setReasoning((current) => {
      if (!current || !isSameReasoning(current, pending))
        return current && current.atVersion > pending.atVersion ? current : pending
      if (current.revision >= pending.revision) return current
      return {
        ...pending,
        text: `${current.text}${pending.text}`,
      }
    })
  }, [setReasoning, store])

  const cancelPendingFrame = useCallback(() => {
    if (!scheduledFrameRef.current) return
    cancelFrame(scheduledFrameRef.current)
    scheduledFrameRef.current = null
  }, [])

  const clear = useCallback(() => {
    cancelPendingFrame()
    pendingReasoningRef.current = null
    setReasoning(null)
  }, [cancelPendingFrame, setReasoning])

  const clearThroughVersion = useCallback(
    (sessionId: string, version: number) => {
      const pending = pendingReasoningRef.current
      if (pending?.sessionId === sessionId && pending.atVersion <= version) {
        cancelPendingFrame()
        pendingReasoningRef.current = null
      }
      setReasoning((current) =>
        current?.sessionId === sessionId && current.atVersion <= version ? null : current,
      )
    },
    [cancelPendingFrame, setReasoning],
  )

  const enqueue = useCallback(
    (event: ReasoningEventData) => {
      if (!event.delta) return
      const view = store.get(difyBuilderSessionViewAtom)
      if (
        store.get(difyBuilderActiveSessionIdAtom) !== event.session_id ||
        view?.session_id !== event.session_id ||
        view.version >= event.at_version
      )
        return

      const next = toReasoning(event)
      const pending = pendingReasoningRef.current
      if (pending && isSameReasoning(pending, next) && pending.revision >= next.revision) return
      if (pending && !isSameReasoning(pending, next) && pending.atVersion > next.atVersion) return
      pendingReasoningRef.current =
        pending && isSameReasoning(pending, next)
          ? { ...next, text: `${pending.text}${next.text}` }
          : next
      if (!scheduledFrameRef.current) scheduledFrameRef.current = scheduleFrame(flush)
    },
    [flush, store],
  )

  useEffect(() => clear, [clear])

  return useMemo(
    () => ({ clear, clearThroughVersion, enqueue }),
    [clear, clearThroughVersion, enqueue],
  )
}
