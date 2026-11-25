'use client'

import type { ChatItem } from './types'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import { useCallback, useEffect, useRef, useState } from 'react'
import { v4 as uuid4 } from 'uuid'

export const MAX_CUT_IN_TEXT_LENGTH = 8000

export type AgentChatCutInReceipt = {
  input_id: string
  pending_inputs: { input_id: string; text: string }[]
}

/**
 * Surface-specific transport for the cut-in: Console preview posts against
 * the scoped agent binding, the published Web App posts against the web
 * chat-messages routes. `interrupt` returns the settled freeze receipt or
 * `null` on failure; `enqueue` replays one frozen input under its original id.
 */
export type AgentChatCutInTransport = {
  interrupt: (
    taskId: string,
    inputId: string,
    text: string,
  ) => Promise<AgentChatCutInReceipt | null>
  enqueue: (taskId: string, inputId: string, text: string) => Promise<boolean>
}

export type AgentChatCutInSend = (
  message: string,
  files?: FileEntity[],
  isRegenerate?: boolean,
  parent?: ChatItem | null,
  onReady?: (taskId: string) => void,
) => Promise<boolean | undefined>

/**
 * Shared cut-in ("interrupt and continue") orchestration for surfaces whose
 * agent runs admit steering inputs. While a scoped run is live, a normal
 * Send of plain text freezes the run's inbox around that text, stops the
 * run, waits for its session snapshot, starts exactly one ordinary new turn
 * in the same conversation, and replays the frozen inputs FIFO into the new
 * run under their original ids. With `enabled` off every send is a plain
 * send, so surfaces without steering admission are untouched.
 */
export function useAgentChatCutIn({
  enabled,
  scopeKey,
  isResponding,
  transport,
  settle,
  send,
}: {
  enabled: boolean
  scopeKey: string
  isResponding: boolean
  transport: AgentChatCutInTransport
  settle: (taskId: string) => boolean
  send: AgentChatCutInSend
}) {
  // Pairs the admitted task id with the scope that produced it so a stale
  // event can never steer a different conversation.
  const [ready, setReady] = useState<{ scopeKey: string; taskId: string } | null>(null)
  const onReady = useCallback(
    (taskId: string) => {
      if (enabled) setReady({ scopeKey, taskId })
    },
    [enabled, scopeKey],
  )
  // Clear the binding only on a responding -> idle transition so a fresh
  // queue-ready frame emitted while the send is still being marked
  // responding is never dropped.
  const wasRespondingRef = useRef(isResponding)
  useEffect(() => {
    if (wasRespondingRef.current && !isResponding) setReady(null)
    wasRespondingRef.current = isResponding
  }, [isResponding])

  const activeTaskId = enabled && isResponding && ready?.scopeKey === scopeKey ? ready.taskId : null
  const canSteer = !!activeTaskId

  const [handoff, setHandoff] = useState<{
    scopeKey: string
    taskId: string
    remaining: { id: string; text: string }[]
  } | null>(null)
  // A failed cut-in step pauses the pipeline until an explicit retry or a
  // new task. Scoped to the scope + task that produced it.
  const [handoffFailed, setHandoffFailed] = useState<{
    kind: 'request' | 'replay'
    scopeKey: string
    taskId: string
  } | null>(null)
  // Locks the whole cut-in transaction before the first await — send, settle,
  // and dispatch run inside it — so a second send can never start a
  // competing turn before the old run's snapshot persisted.
  const handoffLockRef = useRef(false)
  const replayBusyRef = useRef(false)
  // Identity of the in-flight cut-in attempt: retrying the same draft reuses
  // the original task + input id even after the old run's SSE closed and the
  // active task unbound.
  const cutInAttemptRef = useRef<{
    scopeKey: string
    taskId: string
    text: string
    inputId: string
  } | null>(null)
  // Lets async continuations tell whether the scope they captured is still
  // the mounted one.
  const sessionKeyRef = useRef<string | null>(scopeKey)
  useEffect(() => {
    sessionKeyRef.current = scopeKey
    return () => {
      sessionKeyRef.current = null
    }
  }, [scopeKey])

  // Replay the remaining frozen inputs into the new run's inbox, one at a
  // time and only once the new task is live. A failure pauses replay for
  // that task (no hot loop): the item stays in `handoff.remaining` until the
  // next explicit send or a new task arrives.
  useEffect(() => {
    if (!handoff || handoff.scopeKey !== scopeKey) return
    if (handoff.remaining.length === 0 || replayBusyRef.current || handoffLockRef.current) return
    if (!activeTaskId || activeTaskId === handoff.taskId) return
    if (
      handoffFailed?.kind === 'replay' &&
      handoffFailed.scopeKey === scopeKey &&
      handoffFailed.taskId === activeTaskId
    )
      return
    const handoffScope = handoff.scopeKey
    const targetTaskId = activeTaskId
    const next = handoff.remaining[0]
    if (!next) return
    replayBusyRef.current = true
    void transport.enqueue(targetTaskId, next.id, next.text).then((ok) => {
      replayBusyRef.current = false
      if (sessionKeyRef.current !== handoffScope) return
      if (ok) {
        setHandoffFailed(null)
        setHandoff((current) => {
          if (!current) return current
          const remaining = current.remaining.filter((item) => item.id !== next.id)
          return remaining.length ? { ...current, remaining } : null
        })
      } else {
        setHandoffFailed({
          kind: 'replay',
          scopeKey: handoffScope,
          taskId: targetTaskId,
        })
      }
    })
  }, [activeTaskId, scopeKey, handoff, handoffFailed, transport])

  const currentHandoff = handoff?.scopeKey === scopeKey ? handoff : null
  const scopedHandoffFailed = handoffFailed?.scopeKey === scopeKey ? handoffFailed : null
  const sendFailed = !!scopedHandoffFailed

  const handleInputSend: AgentChatCutInSend = useCallback(
    async (message, files, isRegenerate = false, parent = null, readyCallback = onReady) => {
      if (handoffLockRef.current || replayBusyRef.current) return false
      if (!enabled) return send(message, files, isRegenerate, parent, readyCallback)
      const trimmed = message.trim()
      const stored = cutInAttemptRef.current
      // A stored attempt only wins while no different task is live: when a
      // new run is bound, the same draft cuts into it with a fresh identity.
      const retrying =
        !!stored &&
        stored.scopeKey === scopeKey &&
        stored.text === trimmed &&
        trimmed.length > 0 &&
        (!isResponding || !activeTaskId || activeTaskId === stored.taskId)
      if ((isResponding || retrying) && !isRegenerate) {
        // A live run never starts a second turn; the text cuts in instead.
        if (!trimmed || trimmed.length > MAX_CUT_IN_TEXT_LENGTH || files?.length) return false
        const taskId = retrying && stored ? stored.taskId : activeTaskId
        if (!taskId) return false
        handoffLockRef.current = true
        const attempt =
          retrying && stored ? stored : { scopeKey, taskId, text: trimmed, inputId: uuid4() }
        cutInAttemptRef.current = attempt
        try {
          const receipt = await transport.interrupt(attempt.taskId, attempt.inputId, trimmed)
          if (sessionKeyRef.current !== scopeKey) return false
          const selected = receipt?.pending_inputs.find(
            (item) => item.input_id === receipt.input_id,
          )
          if (!receipt || !selected?.text) {
            // Keep the attempt so the next Send re-issues the same freeze
            // against the original task even after its SSE closed.
            setHandoffFailed({ kind: 'request', scopeKey, taskId: attempt.taskId })
            return false
          }
          // The settled receipt already confirms the old run and its snapshot
          // are persisted, so the old transport settles locally inside the
          // same transaction and the new turn dispatches before the textbox
          // clears — a failed send keeps the draft for retry. The dispatch
          // carries `onReady` so the replacement run's queue-ready frame
          // binds the new task id for the replay below.
          if (
            !settle(attempt.taskId) ||
            (await send(selected.text, undefined, false, null, readyCallback)) !== true
          ) {
            if (sessionKeyRef.current === scopeKey)
              setHandoffFailed({ kind: 'request', scopeKey, taskId: attempt.taskId })
            return false
          }
          if (sessionKeyRef.current !== scopeKey) return false
          cutInAttemptRef.current = null
          setHandoffFailed(null)
          // Merge by id: an earlier unplayed remainder stays ahead of the
          // newly frozen inputs, and overlaps dedup to the latest text.
          const remainingById = new Map(
            currentHandoff?.remaining.map((item) => [item.id, item]) ?? [],
          )
          for (const item of receipt.pending_inputs) {
            if (item.input_id !== receipt.input_id)
              remainingById.set(item.input_id, { id: item.input_id, text: item.text })
          }
          setHandoff({
            scopeKey,
            taskId: attempt.taskId,
            remaining: [...remainingById.values()],
          })
          return true
        } finally {
          handoffLockRef.current = false
        }
      }
      return send(message, files, isRegenerate, parent, readyCallback)
    },
    [
      enabled,
      scopeKey,
      isResponding,
      activeTaskId,
      transport,
      settle,
      send,
      currentHandoff,
      onReady,
    ],
  )

  return { onReady, canSteer, sendFailed, send: handleInputSend }
}
