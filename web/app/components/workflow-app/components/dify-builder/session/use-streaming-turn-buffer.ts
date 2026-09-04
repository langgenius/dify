'use client'

import type { AgentMessageEventData } from '@dify/contracts/api/console/dify-builder/types.gen'
import type { DifyBuilderStreamingTurn } from '../types'
import { useSetAtom, useStore } from 'jotai'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  difyBuilderActiveSessionIdAtom,
  difyBuilderSessionViewAtom,
  difyBuilderStreamingTurnAtom,
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
    if (typeof globalThis.cancelAnimationFrame === 'function')
      globalThis.cancelAnimationFrame(frame.id)
    return
  }
  globalThis.clearTimeout(frame.id)
}

const toStreamingTurn = (message: AgentMessageEventData): DifyBuilderStreamingTurn => ({
  sessionId: message.session_id,
  operationId: message.operation_id,
  turnId: message.id,
  sequence: message.seq,
  atVersion: message.at_version,
  revision: message.revision,
  stageId: message.stage_id,
  replyText: message.answer,
})

const isSameTurn = (left: DifyBuilderStreamingTurn, right: DifyBuilderStreamingTurn) =>
  left.sessionId === right.sessionId &&
  left.operationId === right.operationId &&
  left.turnId === right.turnId &&
  left.atVersion === right.atVersion

/**
 * Keeps token-frequency updates out of SessionView. Deltas are buffered in a
 * ref and published to one small atom at most once per animation frame.
 */
export const useDifyBuilderStreamingTurnBuffer = () => {
  const store = useStore()
  const setStreamingTurn = useSetAtom(difyBuilderStreamingTurnAtom)
  const pendingTurnRef = useRef<DifyBuilderStreamingTurn | null>(null)
  const scheduledFrameRef = useRef<ScheduledFrame | null>(null)

  const flush = useCallback(() => {
    scheduledFrameRef.current = null
    const pending = pendingTurnRef.current
    pendingTurnRef.current = null
    if (!pending) return

    const view = store.get(difyBuilderSessionViewAtom)
    if (
      store.get(difyBuilderActiveSessionIdAtom) !== pending.sessionId ||
      view?.session_id !== pending.sessionId ||
      view.version >= pending.atVersion
    )
      return

    setStreamingTurn((current) => {
      if (!current || !isSameTurn(current, pending))
        return current && current.atVersion > pending.atVersion ? current : pending
      if (current.revision >= pending.revision) return current
      return {
        ...pending,
        replyText: `${current.replyText}${pending.replyText}`,
      }
    })
  }, [setStreamingTurn, store])

  const cancelPendingFrame = useCallback(() => {
    if (!scheduledFrameRef.current) return
    cancelFrame(scheduledFrameRef.current)
    scheduledFrameRef.current = null
  }, [])

  const clear = useCallback(() => {
    cancelPendingFrame()
    pendingTurnRef.current = null
    setStreamingTurn(null)
  }, [cancelPendingFrame, setStreamingTurn])

  const clearThroughVersion = useCallback(
    (sessionId: string, version: number) => {
      const pending = pendingTurnRef.current
      if (pending?.sessionId === sessionId && pending.atVersion <= version) {
        cancelPendingFrame()
        pendingTurnRef.current = null
      }
      setStreamingTurn((current) => {
        if (current?.sessionId === sessionId && current.atVersion <= version) return null
        return current
      })
    },
    [cancelPendingFrame, setStreamingTurn],
  )

  const enqueue = useCallback(
    (message: AgentMessageEventData) => {
      if (!message.answer) return
      const view = store.get(difyBuilderSessionViewAtom)
      if (
        store.get(difyBuilderActiveSessionIdAtom) !== message.session_id ||
        view?.session_id !== message.session_id ||
        view.version >= message.at_version
      )
        return

      const next = toStreamingTurn(message)
      const pending = pendingTurnRef.current
      if (pending && isSameTurn(pending, next) && pending.revision >= next.revision) return
      if (pending && !isSameTurn(pending, next) && pending.atVersion > next.atVersion) return
      pendingTurnRef.current =
        pending && isSameTurn(pending, next)
          ? { ...next, replyText: `${pending.replyText}${next.replyText}` }
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
