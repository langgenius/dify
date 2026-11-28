'use client'

import type { DifyBuilderReasoningEventData } from '@dify/contracts/api/console/dify-builder/types.gen'
import type { DifyBuilderReasoning } from '../types'
import type { ScheduledFrame } from './streaming-text'
import { useSetAtom, useStore } from 'jotai'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  difyBuilderActiveCommandAtom,
  difyBuilderActiveSessionIdAtom,
  difyBuilderReasoningAtom,
  difyBuilderSessionViewAtom,
} from './state'
import {
  cancelFrame,
  scheduleFrame,
  STREAM_CHARACTERS_PER_UPDATE,
  STREAM_FIRST_FRAME_CHARACTERS,
  STREAM_MAX_PENDING_CHARACTERS,
  STREAM_UPDATE_INTERVAL_MS,
} from './streaming-text'

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

/** Keeps full reasoning for the committed turn while revealing bounded slices. */
export const useDifyBuilderReasoningBuffer = () => {
  const store = useStore()
  const setReasoning = useSetAtom(difyBuilderReasoningAtom)
  const accumulatedReasoningRef = useRef<DifyBuilderReasoning | null>(null)
  const visibleReasoningRef = useRef<DifyBuilderReasoning | null>(null)
  const scheduledFrameRef = useRef<ScheduledFrame | null>(null)
  const cooldownTimeoutRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null)

  const cancelPendingFrame = useCallback(() => {
    if (scheduledFrameRef.current) {
      cancelFrame(scheduledFrameRef.current)
      scheduledFrameRef.current = null
    }
    if (cooldownTimeoutRef.current !== null) {
      globalThis.clearTimeout(cooldownTimeoutRef.current)
      cooldownTimeoutRef.current = null
    }
  }, [])

  const flush = useCallback(
    function flushPendingText() {
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

      const visible = visibleReasoningRef.current
      const visibleLength =
        visible && isSameReasoning(visible, accumulated) ? visible.text.length : 0
      if (visibleLength >= accumulated.text.length) return

      const revealImmediately =
        accumulated.text.length - visibleLength > STREAM_MAX_PENDING_CHARACTERS ||
        (typeof document !== 'undefined' && document.visibilityState === 'hidden')
      let end = accumulated.text.length
      if (!revealImmediately) {
        const limit = visibleLength ? STREAM_CHARACTERS_PER_UPDATE : STREAM_FIRST_FRAME_CHARACTERS
        end = visibleLength
        for (let count = 0; count < limit && end < accumulated.text.length; count++) {
          end += accumulated.text.codePointAt(end)! > 0xffff ? 2 : 1
        }
      }
      const nextVisible = { ...accumulated, text: accumulated.text.slice(0, end) }
      visibleReasoningRef.current = nextVisible
      setReasoning((current) => {
        if (current && current.atVersion > accumulated.atVersion) return current
        return nextVisible
      })

      cooldownTimeoutRef.current = globalThis.setTimeout(() => {
        cooldownTimeoutRef.current = null
        const pending = accumulatedReasoningRef.current
        if (pending && pending.text.length > (visibleReasoningRef.current?.text.length ?? 0))
          scheduledFrameRef.current = scheduleFrame(flushPendingText)
      }, STREAM_UPDATE_INTERVAL_MS)
    },
    [setReasoning, store],
  )

  const accumulate = useCallback(
    (event: DifyBuilderReasoningEventData) => {
      const next = toReasoning(event)
      const current = accumulatedReasoningRef.current
      if (current && isSameReasoning(current, next) && current.revision >= next.revision)
        return null
      if (current && !isSameReasoning(current, next) && current.atVersion > next.atVersion)
        return null
      if (current && !isSameReasoning(current, next)) {
        cancelPendingFrame()
        visibleReasoningRef.current = null
      }
      const accumulated =
        current && isSameReasoning(current, next)
          ? { ...next, text: `${current.text}${next.text}` }
          : next
      accumulatedReasoningRef.current = accumulated
      return accumulated
    },
    [cancelPendingFrame],
  )

  const clear = useCallback(() => {
    cancelPendingFrame()
    accumulatedReasoningRef.current = null
    visibleReasoningRef.current = null
    setReasoning(null)
  }, [cancelPendingFrame, setReasoning])

  const clearThroughVersion = useCallback(
    (sessionId: string, version: number) => {
      const accumulated = accumulatedReasoningRef.current
      if (accumulated?.sessionId === sessionId && accumulated.atVersion <= version) {
        cancelPendingFrame()
        accumulatedReasoningRef.current = null
        visibleReasoningRef.current = null
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

      const accumulated = accumulate(event)
      if (!accumulated) return
      if (
        cooldownTimeoutRef.current !== null &&
        (accumulated.text.length - (visibleReasoningRef.current?.text.length ?? 0) >
          STREAM_MAX_PENDING_CHARACTERS ||
          (typeof document !== 'undefined' && document.visibilityState === 'hidden'))
      ) {
        globalThis.clearTimeout(cooldownTimeoutRef.current)
        cooldownTimeoutRef.current = null
      }
      if (!scheduledFrameRef.current && cooldownTimeoutRef.current === null)
        scheduledFrameRef.current = scheduleFrame(flush)
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
      visibleReasoningRef.current = null
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
