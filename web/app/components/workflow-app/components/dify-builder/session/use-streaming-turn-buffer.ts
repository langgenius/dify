'use client'

import type { DifyBuilderAgentMessageEventData } from '@dify/contracts/api/console/dify-builder/types.gen'
import type { DifyBuilderStreamingTurn } from '../types'
import { useSetAtom, useStore } from 'jotai'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  difyBuilderActiveCommandAtom,
  difyBuilderActiveSessionIdAtom,
  difyBuilderSessionViewAtom,
  difyBuilderStreamingTurnAtom,
} from './state'

type ScheduledFrame = {
  animationFrameId: number | null
  timeoutId: ReturnType<typeof globalThis.setTimeout>
}

const FRAME_FALLBACK_MS = 100

const scheduleFrame = (callback: () => void): ScheduledFrame => {
  if (
    typeof globalThis.requestAnimationFrame === 'function' &&
    (typeof document === 'undefined' || document.visibilityState !== 'hidden')
  ) {
    let animationFrameId = 0
    const timeoutId = globalThis.setTimeout(() => {
      if (typeof globalThis.cancelAnimationFrame === 'function')
        globalThis.cancelAnimationFrame(animationFrameId)
      callback()
    }, FRAME_FALLBACK_MS)
    animationFrameId = globalThis.requestAnimationFrame(() => {
      globalThis.clearTimeout(timeoutId)
      callback()
    })
    return {
      animationFrameId,
      timeoutId,
    }
  }

  return {
    animationFrameId: null,
    timeoutId: globalThis.setTimeout(callback, 16),
  }
}

const cancelFrame = (frame: ScheduledFrame) => {
  globalThis.clearTimeout(frame.timeoutId)
  if (frame.animationFrameId !== null && typeof globalThis.cancelAnimationFrame === 'function')
    globalThis.cancelAnimationFrame(frame.animationFrameId)
}

const toStreamingTurn = (message: DifyBuilderAgentMessageEventData): DifyBuilderStreamingTurn => ({
  sessionId: message.session_id,
  commandId: message.command_id,
  operationId: message.operation_id,
  turnId: message.turn_id,
  sequence: message.seq,
  atVersion: message.at_version,
  revision: message.revision,
  textBytes: message.text_bytes,
  replyText: message.delta,
})

const isSameTurn = (left: DifyBuilderStreamingTurn, right: DifyBuilderStreamingTurn) =>
  left.sessionId === right.sessionId &&
  left.commandId === right.commandId &&
  left.operationId === right.operationId &&
  left.turnId === right.turnId &&
  left.sequence === right.sequence &&
  left.atVersion === right.atVersion

const utf8ByteLength = (text: string) => new TextEncoder().encode(text).byteLength
const STREAM_CHARACTERS_PER_FRAME = 24

type FinishWaiter = {
  turn: DifyBuilderStreamingTurn
  resolve: (turn: DifyBuilderStreamingTurn | null) => void
}

/**
 * Keeps token-frequency updates out of SessionView. Server deltas accumulate
 * in refs, while one small atom reveals a bounded slice per animation frame.
 * The final marker resolves only after the visible queue has painted, which
 * keeps later conversation items from appearing alongside an unstreamed reply.
 */
export const useDifyBuilderStreamingTurnBuffer = () => {
  const store = useStore()
  const setStreamingTurn = useSetAtom(difyBuilderStreamingTurnAtom)
  const accumulatedTurnRef = useRef<DifyBuilderStreamingTurn | null>(null)
  const visibleTurnRef = useRef<DifyBuilderStreamingTurn | null>(null)
  const pendingTextRef = useRef('')
  const finishedTurnRef = useRef<DifyBuilderStreamingTurn | null>(null)
  const finishWaiterRef = useRef<FinishWaiter | null>(null)
  const scheduledFrameRef = useRef<ScheduledFrame | null>(null)

  const cancelPendingFrame = useCallback(() => {
    if (!scheduledFrameRef.current) return
    cancelFrame(scheduledFrameRef.current)
    scheduledFrameRef.current = null
  }, [])

  const completeTurn = useCallback(
    (turn: DifyBuilderStreamingTurn) => {
      accumulatedTurnRef.current = null
      visibleTurnRef.current = null
      pendingTextRef.current = ''
      finishedTurnRef.current = turn
      setStreamingTurn((current) => (current && isSameTurn(current, turn) ? null : current))
      const waiter = finishWaiterRef.current
      finishWaiterRef.current = null
      if (waiter && isSameTurn(waiter.turn, turn)) waiter.resolve(turn)
    },
    [setStreamingTurn],
  )

  const discardTurn = useCallback(
    (turn: DifyBuilderStreamingTurn | null) => {
      cancelPendingFrame()
      accumulatedTurnRef.current = null
      visibleTurnRef.current = null
      pendingTextRef.current = ''
      const waiter = finishWaiterRef.current
      finishWaiterRef.current = null
      waiter?.resolve(null)
      setStreamingTurn((current) =>
        !turn || (current && isSameTurn(current, turn)) ? null : current,
      )
    },
    [cancelPendingFrame, setStreamingTurn],
  )

  const accumulate = useCallback((message: DifyBuilderAgentMessageEventData) => {
    const next = toStreamingTurn(message)
    const finished = finishedTurnRef.current
    if (finished && isSameTurn(finished, next) && finished.revision >= next.revision) return null

    const current = accumulatedTurnRef.current
    if (current && isSameTurn(current, next) && current.revision >= next.revision) return null
    if (current && !isSameTurn(current, next) && current.atVersion > next.atVersion) return null
    if (current && !isSameTurn(current, next)) {
      finishWaiterRef.current?.resolve(null)
      finishWaiterRef.current = null
      visibleTurnRef.current = null
      pendingTextRef.current = ''
    }
    const accumulated =
      current && isSameTurn(current, next)
        ? { ...next, replyText: `${current.replyText}${next.replyText}` }
        : next
    accumulatedTurnRef.current = accumulated
    pendingTextRef.current += next.replyText
    return accumulated
  }, [])

  const flush = useCallback(
    function flushPendingText() {
      scheduledFrameRef.current = null
      const accumulated = accumulatedTurnRef.current
      if (!accumulated) return

      const view = store.get(difyBuilderSessionViewAtom)
      const activeCommand = store.get(difyBuilderActiveCommandAtom)
      if (
        store.get(difyBuilderActiveSessionIdAtom) !== accumulated.sessionId ||
        (view?.session_id !== accumulated.sessionId &&
          activeCommand?.session_id !== accumulated.sessionId) ||
        (view?.session_id === accumulated.sessionId && view.version >= accumulated.atVersion)
      ) {
        discardTurn(accumulated)
        return
      }

      const pending = pendingTextRef.current
      const revealedText = Boolean(pending)
      if (pending) {
        const codePoints = Array.from(pending)
        const revealImmediately =
          typeof document !== 'undefined' && document.visibilityState === 'hidden'
        const size = revealImmediately
          ? codePoints.length
          : Math.min(STREAM_CHARACTERS_PER_FRAME, codePoints.length)
        const delta = codePoints.slice(0, size).join('')
        pendingTextRef.current = pending.slice(delta.length)
        const visible = visibleTurnRef.current
        const nextVisible = {
          ...accumulated,
          replyText: `${visible && isSameTurn(visible, accumulated) ? visible.replyText : ''}${delta}`,
        }
        visibleTurnRef.current = nextVisible
        setStreamingTurn((current) => {
          if (current && current.atVersion > nextVisible.atVersion) return current
          return nextVisible
        })
      }

      if (pendingTextRef.current) {
        scheduledFrameRef.current = scheduleFrame(flushPendingText)
        return
      }
      const waiter = finishWaiterRef.current
      if (waiter && isSameTurn(waiter.turn, accumulated)) {
        // Let the final visible chunk paint once before replacing the transient
        // bubble with its durable conversation item and processing later cards.
        if (revealedText) {
          scheduledFrameRef.current = scheduleFrame(flushPendingText)
          return
        }
        completeTurn(accumulated)
      }
    },
    [completeTurn, discardTurn, setStreamingTurn, store],
  )

  const clear = useCallback(() => {
    discardTurn(accumulatedTurnRef.current)
    finishedTurnRef.current = null
  }, [discardTurn])

  const clearThroughVersion = useCallback(
    (sessionId: string, version: number) => {
      const accumulated = accumulatedTurnRef.current
      if (accumulated?.sessionId === sessionId && accumulated.atVersion <= version) {
        discardTurn(accumulated)
      }
      const finished = finishedTurnRef.current
      if (finished?.sessionId === sessionId && finished.atVersion <= version)
        finishedTurnRef.current = null
      setStreamingTurn((current) => {
        if (current?.sessionId === sessionId && current.atVersion <= version) return null
        return current
      })
    },
    [discardTurn, setStreamingTurn],
  )

  const enqueue = useCallback(
    (message: DifyBuilderAgentMessageEventData) => {
      if (!message.delta || message.done) return
      const view = store.get(difyBuilderSessionViewAtom)
      const activeCommand = store.get(difyBuilderActiveCommandAtom)
      if (
        store.get(difyBuilderActiveSessionIdAtom) !== message.session_id ||
        (view?.session_id !== message.session_id &&
          activeCommand?.session_id !== message.session_id) ||
        (view?.session_id === message.session_id && view.version >= message.at_version)
      )
        return

      if (!accumulate(message)) return

      if (!scheduledFrameRef.current) scheduledFrameRef.current = scheduleFrame(flush)
    },
    [accumulate, flush, store],
  )

  const finish = useCallback(
    (message: DifyBuilderAgentMessageEventData): Promise<DifyBuilderStreamingTurn | null> => {
      if (!message.done) return Promise.resolve(null)
      const view = store.get(difyBuilderSessionViewAtom)
      const activeCommand = store.get(difyBuilderActiveCommandAtom)
      if (
        store.get(difyBuilderActiveSessionIdAtom) !== message.session_id ||
        (view?.session_id !== message.session_id &&
          activeCommand?.session_id !== message.session_id) ||
        (view?.session_id === message.session_id && view.version >= message.at_version)
      )
        return Promise.resolve(null)

      const accumulated = accumulate(message)
      if (!accumulated) return Promise.resolve(null)
      if (utf8ByteLength(accumulated.replyText) !== message.text_bytes) {
        discardTurn(accumulated)
        return Promise.resolve(null)
      }

      return new Promise((resolve) => {
        finishWaiterRef.current = { turn: accumulated, resolve }
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
          cancelPendingFrame()
          completeTurn(accumulated)
          return
        }
        if (!pendingTextRef.current) {
          completeTurn(accumulated)
          return
        }
        if (!scheduledFrameRef.current) scheduledFrameRef.current = scheduleFrame(flush)
      })
    },
    [accumulate, cancelPendingFrame, completeTurn, discardTurn, flush, store],
  )

  useEffect(() => clear, [clear])

  return useMemo(
    () => ({ clear, clearThroughVersion, enqueue, finish }),
    [clear, clearThroughVersion, enqueue, finish],
  )
}
