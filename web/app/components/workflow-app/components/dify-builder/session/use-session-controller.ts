'use client'

import type {
  DifyBuilderCanvasEventData,
  DifyBuilderReceiptSnapshot,
  DifyBuilderStreamEventResponse,
} from '@dify/contracts/api/console/dify-builder/types.gen'
import type {
  ChecklistErrorPayload,
  ConversationItem,
  DifyBuilderSessionController,
  SessionModel,
  SessionView,
} from '../types'
import type { SessionCommandOptions, SessionRunEvents, SessionStreamOutcome } from './types'
import { useAtomValue, useSetAtom, useStore } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import { useCallback, useEffect, useEffectEvent, useMemo, useRef } from 'react'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { consoleQuery } from '@/service/console'
import { difyBuilderCanvasReadyAtom } from '../store'
import {
  createBuildSession,
  createChecklistFixSession,
  createEditSession,
  createFixSession,
  getSession,
  getSessionConversation,
  getSessionStream,
  runSessionAction,
  sendSessionMessage,
} from './client'
import {
  requestErrorCode,
  requestErrorMessage,
  requestErrorStatus,
  streamErrorMessage,
  UNEXPECTED_EOF_ERROR,
} from './errors'
import { hasConversationRange, mergeConversation, projectSessionView } from './projection'
import {
  difyBuilderActiveCommandAtom,
  difyBuilderActiveSessionIdAtom,
  difyBuilderConversationAtom,
  difyBuilderConversationHasMoreAtom,
  difyBuilderConversationLoadingAtom,
  difyBuilderLocalUserMessageAtom,
  difyBuilderRetryableMessageAtom,
  difyBuilderSessionBusyAtom,
  difyBuilderSessionErrorCodeAtom,
  difyBuilderSessionLastErrorAtom,
  difyBuilderSessionViewAtom,
} from './state'
import { createTraceBuffer, readTraceVersion } from './trace-buffer'
import { useDifyBuilderExecutionProgress } from './use-execution-progress'
import { useDifyBuilderReasoningBuffer } from './use-reasoning-buffer'
import { useDifyBuilderStreamingTurnBuffer } from './use-streaming-turn-buffer'

const MAX_RECONCILE_ATTEMPTS = 3
const COMMAND_FINISHED_UNAVAILABLE_CODE = 'command_finished_unavailable'
const isActiveRunStatus = (status: SessionView['run_status']) => status === 'processing'
const isActiveView = (view: SessionView) => isActiveRunStatus(view.run_status) && !view.interrupted

const olderNativeReceipt = (
  current: SessionView['test_execution'],
  incoming: SessionView['test_execution'],
) =>
  current &&
  incoming &&
  current.request_id === incoming.request_id &&
  (incoming.generation < current.generation ||
    (incoming.generation === current.generation && incoming.version < current.version) ||
    (incoming.generation === current.generation &&
      incoming.version === current.version &&
      (incoming.decision_public_revision ?? 0) < (current.decision_public_revision ?? 0)))

const sameNativeReceiptOrder = (
  current: SessionView['test_execution'],
  incoming: SessionView['test_execution'],
) =>
  current &&
  incoming &&
  current.request_id === incoming.request_id &&
  current.generation === incoming.generation &&
  current.version === incoming.version &&
  (current.decision_public_revision ?? 0) === (incoming.decision_public_revision ?? 0)

const hasNativeResult = (receipt: SessionView['test_execution'], items: ConversationItem[]) =>
  Boolean(
    receipt?.native_run_id &&
    items.some(
      (item) =>
        item.kind === 'test_result' &&
        item.payload.dify_run_id === receipt.native_run_id &&
        (item.payload.status === 'succeeded' || item.payload.status === 'failed'),
    ),
  )

// A delayed JSON page must not replace a row already updated by live SSE.
const mergeConversationPage = (current: ConversationItem[], page: ConversationItem[]) => {
  const versions = new Map(current.map((item) => [item.seq, item.at_version]))
  return mergeConversation(
    current,
    page.filter((item) => (versions.get(item.seq) ?? -1) <= item.at_version),
  )
}

/**
 * Owns the Dify Builder session lifecycle. Live commands render directly from
 * bounded command lifecycle SSE events and paginated JSON history. Token
 * deltas use an isolated frame-buffered atom and are promoted into the chat by
 * the final agent_message frame. command_finished confirms persistence; GET
 * owns initial restore and missing-sequence recovery only.
 */
export function useDifyBuilderSessionController(
  prepareCommand?: (saveDraft: boolean, signal: AbortSignal) => Promise<void>,
  runEvents?: SessionRunEvents,
): DifyBuilderSessionController {
  const store = useStore()
  const observedView = useAtomValue(difyBuilderSessionViewAtom)
  // Keep native observation alive through terminal history hydration. Command
  // requests have a separate controller and never own this subscription.
  const observedSessionId = observedView?.test_execution ? observedView.session_id : null
  const observedRequestId = observedView?.test_execution?.request_id
  const setActiveSessionId = useSetAtom(difyBuilderActiveSessionIdAtom)
  const setActiveCommand = useSetAtom(difyBuilderActiveCommandAtom)
  const setConversation = useSetAtom(difyBuilderConversationAtom)
  const setConversationHasMore = useSetAtom(difyBuilderConversationHasMoreAtom)
  const setConversationLoading = useSetAtom(difyBuilderConversationLoadingAtom)
  const setLocalUserMessage = useSetAtom(difyBuilderLocalUserMessageAtom)
  const setRetryableMessage = useSetAtom(difyBuilderRetryableMessageAtom)
  const setView = useSetAtom(difyBuilderSessionViewAtom)
  const setLastError = useSetAtom(difyBuilderSessionLastErrorAtom)
  const setIsBusy = useSetAtom(difyBuilderSessionBusyAtom)
  const executionProgress = useDifyBuilderExecutionProgress()
  const reasoningBuffer = useDifyBuilderReasoningBuffer()
  const streamingTurnBuffer = useDifyBuilderStreamingTurnBuffer()
  const abortRef = useRef<AbortController | null>(null)
  const canvasCursorRef = useRef<
    | Pick<DifyBuilderCanvasEventData, 'at_version' | 'operation_id' | 'revision' | 'session_id'>
    | undefined
  >(undefined)
  const nativeObservationRef = useRef(0)
  const pendingActionRef = useRef<{ signature: string; id: string } | null>(null)
  const pendingMessageRef = useRef<{ sessionId: string; text: string; turnId: string } | null>(null)
  const pendingRetestRef = useRef<{
    sessionId: string
    version: number
    appRevision: string
    actionId: string
  } | null>(null)
  const traceRef = useRef(createTraceBuffer())
  const resetRunOnUnmount = useEffectEvent(() => runEvents?.reset())

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      abortRef.current = null
      pendingRetestRef.current = null
      // Clearing the request ref prevents its finally block from releasing loading state.
      setIsBusy(false)
      setConversationLoading(false)
      resetRunOnUnmount()
    }
  }, [setConversationLoading, setIsBusy])

  const applySessionView = useCallback(
    (nextView: SessionView, observedAtStart: number | 'native' = nativeObservationRef.current) => {
      const activeSessionId = store.get(difyBuilderActiveSessionIdAtom)
      if (activeSessionId && activeSessionId !== nextView.session_id) return false

      const current = store.get(difyBuilderSessionViewAtom)
      // Ordinary command projections do not opt into native metadata. Their
      // omission must not end an independently observed native continuation.
      // A snapshot request already in flight when native SSE advances cannot
      // order equal-counter receipts. A fresh recovery GET can still advance.
      const preserveObservedReceipt =
        observedAtStart !== 'native' &&
        observedAtStart < nativeObservationRef.current &&
        sameNativeReceiptOrder(current?.test_execution, nextView.test_execution)
      const preserveReceipt =
        current?.session_id === nextView.session_id &&
        (nextView.test_execution === undefined ||
          olderNativeReceipt(current.test_execution, nextView.test_execution) ||
          preserveObservedReceipt)
      const incoming = preserveReceipt
        ? { ...nextView, test_execution: current.test_execution }
        : nextView
      const projected = projectSessionView(current, incoming)
      if (!projected) return false

      // Bounded JSON/SSE session projections replace metadata atomically;
      // durable conversation rows have their own paginated owner.
      if (observedAtStart === 'native' && !preserveReceipt) nativeObservationRef.current += 1
      setView(projected)
      const canvasCursor = canvasCursorRef.current
      if (
        canvasCursor &&
        (canvasCursor.session_id !== projected.session_id ||
          canvasCursor.at_version <= projected.version)
      )
        canvasCursorRef.current = undefined
      // A finished task is still the current, recoverable conversation.
      setActiveSessionId(projected.session_id)
      return true
    },
    [setActiveSessionId, setView, store],
  )

  const confirmLocalUserMessage = useCallback(
    (sessionId: string, items: ConversationItem[]) => {
      setLocalUserMessage((current) => {
        if (!current || current.sessionId !== sessionId) return current
        return items.some(
          (item) =>
            item.kind === 'user' &&
            (current.turnId
              ? item.payload.turn_id === current.turnId
              : item.payload.text === current.text),
        )
          ? null
          : current
      })
    },
    [setLocalUserMessage],
  )

  const syncConversation = useCallback(
    async (
      sessionId: string,
      targetLastSeq: number,
      controller: AbortController,
      replaceWithLatest = false,
    ) => {
      let items =
        replaceWithLatest || store.get(difyBuilderSessionViewAtom)?.session_id !== sessionId
          ? []
          : store.get(difyBuilderConversationAtom)

      if (replaceWithLatest || items.length === 0) {
        const page = await getSessionConversation(
          sessionId,
          { before_seq: targetLastSeq + 1, limit: 20 },
          controller.signal,
        )
        if (controller.signal.aborted || store.get(difyBuilderActiveSessionIdAtom) !== sessionId)
          return false
        const pageItems = page.data.filter((item) => item.seq <= targetLastSeq)
        items = mergeConversationPage(store.get(difyBuilderConversationAtom), pageItems)
        setConversation(items)
        confirmLocalUserMessage(sessionId, items)
        setConversationHasMore(page.has_more)
      }

      let lastSeq = items.at(-1)?.seq ?? -1
      while (lastSeq < targetLastSeq) {
        const page = await getSessionConversation(
          sessionId,
          { after_seq: lastSeq, limit: 100 },
          controller.signal,
        )
        if (controller.signal.aborted || store.get(difyBuilderActiveSessionIdAtom) !== sessionId)
          return false
        const boundedPage = page.data.filter((item) => item.seq <= targetLastSeq)
        const merged = mergeConversationPage(store.get(difyBuilderConversationAtom), boundedPage)
        const nextLastSeq = merged.at(-1)?.seq ?? -1
        if (nextLastSeq <= lastSeq) return false
        items = merged
        lastSeq = nextLastSeq
        setConversation(items)
        confirmLocalUserMessage(sessionId, boundedPage)
        if (!page.has_more) break
      }
      if (lastSeq >= targetLastSeq) runEvents?.restoreRun(sessionId, items)
      return lastSeq >= targetLastSeq
    },
    [confirmLocalUserMessage, runEvents, setConversation, setConversationHasMore, store],
  )

  const syncConversationRange = useCallback(
    async (
      sessionId: string,
      afterSequence: number,
      targetLastSeq: number,
      controller: AbortController,
    ) => {
      let items = store.get(difyBuilderConversationAtom)
      let cursor = afterSequence

      while (cursor < targetLastSeq) {
        const sequences = new Set(items.map((item) => item.seq))
        while (cursor < targetLastSeq && sequences.has(cursor + 1)) cursor += 1
        if (cursor >= targetLastSeq) break

        const page = await getSessionConversation(
          sessionId,
          { after_seq: cursor, limit: 100 },
          controller.signal,
        )
        if (controller.signal.aborted || store.get(difyBuilderActiveSessionIdAtom) !== sessionId)
          return false
        const boundedPage = page.data.filter((item) => item.seq <= targetLastSeq)
        const merged = mergeConversationPage(store.get(difyBuilderConversationAtom), boundedPage)
        const mergedSequences = new Set(merged.map((item) => item.seq))
        let nextCursor = cursor
        while (nextCursor < targetLastSeq && mergedSequences.has(nextCursor + 1)) nextCursor += 1
        if (nextCursor === cursor) return false
        items = merged
        cursor = nextCursor
        setConversation(items)
        confirmLocalUserMessage(sessionId, boundedPage)
      }

      const complete = hasConversationRange(items, afterSequence, targetLastSeq)
      if (complete) runEvents?.restoreRun(sessionId, items)
      return complete
    },
    [confirmLocalUserMessage, runEvents, setConversation, store],
  )

  const clearSession = useCallback(
    (sessionId: string) => {
      setActiveSessionId((current) => (current === sessionId ? null : current))
      setActiveCommand((current) => (current?.session_id === sessionId ? null : current))
      setView((current) => (current?.session_id === sessionId ? null : current))
      setConversation([])
      setConversationHasMore(false)
      setLocalUserMessage(null)
      setRetryableMessage(null)
      executionProgress.clear()
      reasoningBuffer.clear()
      streamingTurnBuffer.clear()
      runEvents?.reset()
    },
    [
      executionProgress,
      reasoningBuffer,
      runEvents,
      setActiveSessionId,
      setActiveCommand,
      setConversation,
      setConversationHasMore,
      setLocalUserMessage,
      setRetryableMessage,
      setView,
      streamingTurnBuffer,
    ],
  )

  const consumeStream = useCallback(
    async (
      events: AsyncIterable<DifyBuilderStreamEventResponse>,
      controller: AbortController,
      initialSessionId?: string,
      observedAtStart = nativeObservationRef.current,
    ): Promise<SessionStreamOutcome> => {
      const currentView = store.get(difyBuilderSessionViewAtom)
      const outcome: SessionStreamOutcome = {
        sessionId: initialSessionId,
        sawCommandStarted: false,
        terminalEvent: null,
        conversationStartSeq:
          initialSessionId && currentView?.session_id === initialSessionId
            ? (store.get(difyBuilderConversationAtom).at(-1)?.seq ?? -1)
            : -1,
      }
      const handleEvent = async (event: DifyBuilderStreamEventResponse): Promise<boolean> => {
        // payload is captured shallow-by-reference here; it is only
        // serialized (deep-cloned/stringified) later, at export time.
        traceRef.current.append({
          dir: 'in',
          kind: event.event,
          payload: event.data,
          version: readTraceVersion(event.data),
        })

        if (event.event === 'command_started') {
          outcome.sawCommandStarted = true
          outcome.sessionId = event.data.session_id
          outcome.commandId = event.data.command_id
          outcome.commandStartedVersion = event.data.version
          outcome.observedVersion = Math.max(outcome.observedVersion ?? 0, event.data.version)
          const currentView = store.get(difyBuilderSessionViewAtom)
          const currentItems =
            currentView?.session_id === event.data.session_id
              ? store.get(difyBuilderConversationAtom)
              : []
          outcome.conversationStartSeq = currentItems.at(-1)?.seq ?? -1
          setActiveSessionId(event.data.session_id)
          setActiveCommand(event.data)
          setLocalUserMessage((current) =>
            current?.sessionId === null
              ? { ...current, sessionId: event.data.session_id }
              : current,
          )
          executionProgress.clear()
          reasoningBuffer.clear()
          streamingTurnBuffer.clear()
          return false
        }

        if (event.event === 'canvas' || event.event === 'workflow') {
          const view = store.get(difyBuilderSessionViewAtom)
          const activeCommand = store.get(difyBuilderActiveCommandAtom)
          const cursor = canvasCursorRef.current
          if (
            store.get(difyBuilderActiveSessionIdAtom) !== event.data.session_id ||
            (view?.session_id === event.data.session_id && view.version >= event.data.at_version) ||
            (activeCommand?.session_id === event.data.session_id &&
              activeCommand.version >= event.data.at_version) ||
            (cursor?.session_id === event.data.session_id &&
              (cursor.at_version > event.data.at_version ||
                (cursor.at_version === event.data.at_version &&
                  cursor.operation_id === event.data.operation_id &&
                  cursor.revision >= event.data.revision)))
          )
            return false

          canvasCursorRef.current = event.data
          if (event.event === 'canvas') {
            runEvents?.onCanvasEvent(event.data)
          } else {
            runEvents?.onWorkflowEvent(event.data)
          }
          return false
        }

        if (event.event === 'reasoning') {
          outcome.sessionId = event.data.session_id
          reasoningBuffer.enqueue(event.data)
          return false
        }

        if (event.event === 'progress' || event.event === 'progress_snapshot') {
          outcome.sessionId = event.data.session_id
          executionProgress.enqueue(event.data)
          return false
        }

        if (event.event === 'conversation_item_appended') {
          if (outcome.commandId && event.data.command_id !== outcome.commandId) return false
          outcome.sessionId = event.data.session_id
          if (store.get(difyBuilderActiveSessionIdAtom) !== event.data.session_id) return false
          const item = event.data.item
          setConversation((current) =>
            mergeConversation(current, [
              item.kind === 'assistant_turn' &&
              !current.some((candidate) => candidate.seq === item.seq)
                ? { ...item, receivedAt: Date.now() }
                : item,
            ]),
          )
          if (item.kind === 'assistant_turn') {
            executionProgress.clearThroughVersion(event.data.session_id, item.at_version)
            reasoningBuffer.clearThroughVersion(event.data.session_id, item.at_version)
          }
          confirmLocalUserMessage(event.data.session_id, [event.data.item])
          return false
        }

        if (event.event === 'agent_message') {
          if (outcome.commandId && event.data.command_id !== outcome.commandId) return false
          outcome.sessionId = event.data.session_id
          if (!event.data.done) {
            streamingTurnBuffer.enqueue(event.data)
            return false
          }

          const streamedTurn = await streamingTurnBuffer.finish(event.data)
          if (!streamedTurn) return false
          const reasoningText = reasoningBuffer.finish(
            event.data.session_id,
            event.data.operation_id,
            event.data.at_version,
          )
          const assistantItem: Extract<ConversationItem, { kind: 'assistant_turn' }> = {
            seq: event.data.seq,
            at_version: event.data.at_version,
            kind: 'assistant_turn',
            payload: {
              turn_id: event.data.turn_id,
              execution: event.data.execution ?? { status: 'completed', activities: [] },
              reasoning_text: reasoningText || undefined,
              reply_text: streamedTurn.replyText || undefined,
              cards: event.data.cards ?? [],
            },
          }
          setConversation((current) => mergeConversation(current, [assistantItem]))
          executionProgress.clearThroughVersion(event.data.session_id, event.data.at_version)
          return false
        }

        if (event.event === 'command_finished') {
          if (outcome.commandId && event.data.command_id !== outcome.commandId) return false
          outcome.terminalEvent = 'command_finished'
          outcome.sessionId = event.data.session_id
          outcome.finishedCommandId = event.data.command_id
          const {
            command_id,
            post_canvas_action_id: postCanvasActionId,
            ...finishedState
          } = event.data
          const stateView: SessionView = { ...finishedState, last_command_id: command_id }
          outcome.observedVersion = Math.max(outcome.observedVersion ?? 0, stateView.version)
          outcome.terminalInterrupted = stateView.interrupted
          outcome.terminalRunStatus = stateView.run_status
          const stateApplied = applySessionView(stateView, observedAtStart)
          setActiveCommand((current) =>
            current?.session_id === stateView.session_id ? null : current,
          )
          if (stateApplied && postCanvasActionId && stateView.app_revision) {
            pendingRetestRef.current = {
              sessionId: stateView.session_id,
              version: stateView.version,
              appRevision: stateView.app_revision.current,
              actionId: postCanvasActionId,
            }
          }
          const conversationStartSeq = outcome.conversationStartSeq ?? -1
          let historyApplied = hasConversationRange(
            store.get(difyBuilderConversationAtom),
            conversationStartSeq,
            stateView.conversation_last_seq,
          )
          if (!historyApplied) {
            historyApplied = await syncConversationRange(
              stateView.session_id,
              conversationStartSeq,
              stateView.conversation_last_seq,
              controller,
            )
          }
          if (stateApplied && historyApplied) {
            executionProgress.clear()
            reasoningBuffer.clear()
            streamingTurnBuffer.clear()
          }
          outcome.stateApplied = stateApplied && historyApplied
          return true
        }

        if (event.event === 'error') {
          if (
            outcome.commandId &&
            event.data.command_id &&
            event.data.command_id !== outcome.commandId
          )
            return false
          outcome.terminalEvent = 'error'
          outcome.sessionId = event.data.session_id ?? outcome.sessionId
          outcome.finishedCommandId = event.data.command_id ?? undefined
          outcome.terminalError = streamErrorMessage(event.data)
          outcome.terminalErrorCode = event.data.code ?? undefined
          setActiveCommand((current) =>
            !event.data.session_id || current?.session_id === event.data.session_id
              ? null
              : current,
          )
          setLastError(outcome.terminalError)
          return true
        }
        return false
      }

      try {
        for await (const event of events) {
          if (controller.signal.aborted || (await handleEvent(event))) break
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          const message = await requestErrorMessage(error)
          if (controller.signal.aborted) return outcome
          outcome.transportError = message
          outcome.transportStatus = requestErrorStatus(error)
        }
      }

      if (!controller.signal.aborted && !outcome.terminalEvent) runEvents?.onStreamInterrupted()
      return outcome
    },
    [
      applySessionView,
      confirmLocalUserMessage,
      executionProgress,
      reasoningBuffer,
      runEvents,
      setActiveCommand,
      setActiveSessionId,
      setConversation,
      setLastError,
      setLocalUserMessage,
      store,
      syncConversationRange,
      streamingTurnBuffer,
    ],
  )

  const reconcileSession = useCallback(
    async (sessionId: string, controller: AbortController, replaceConversation = false) => {
      let latestOutcome: SessionStreamOutcome | undefined
      for (let attempt = 0; attempt < MAX_RECONCILE_ATTEMPTS; attempt += 1) {
        if (controller.signal.aborted) return latestOutcome
        try {
          const observedAtStart = nativeObservationRef.current
          const view = await getSession(sessionId, controller.signal)
          if (controller.signal.aborted) return latestOutcome
          traceRef.current.append({
            dir: 'in',
            kind: 'session_snapshot',
            payload: view,
            version: view.version,
          })
          const stateApplied = applySessionView(view, observedAtStart)
          if (isActiveView(view)) {
            setActiveCommand({
              session_id: view.session_id,
              version: view.version,
              phase: view.phase,
              run_status: view.run_status,
            })
          } else {
            setActiveCommand((current) =>
              current?.session_id === view.session_id ? null : current,
            )
          }
          const historyApplied = await syncConversation(
            sessionId,
            view.conversation_last_seq,
            controller,
            replaceConversation && attempt === 0,
          )
          latestOutcome = {
            sessionId,
            sawCommandStarted: false,
            terminalEvent: isActiveView(view) ? null : 'command_finished',
            terminalInterrupted: view.interrupted,
            terminalRunStatus: view.run_status,
            observedVersion: view.version,
            finishedCommandId: view.last_command_id,
            stateApplied: stateApplied && historyApplied,
          }
          if (!isActiveView(view)) return latestOutcome

          traceRef.current.append({
            dir: 'out',
            kind: 'session_reconnect',
            payload: { session_id: sessionId },
          })
          const streamObservedAtStart = nativeObservationRef.current
          const events = await getSessionStream(sessionId, controller.signal)
          latestOutcome = await consumeStream(events, controller, sessionId, streamObservedAtStart)
          if (latestOutcome.terminalEvent === 'command_finished') return latestOutcome
        } catch (error) {
          // A reconnect is best-effort. A later attempt may observe the
          // durable state after a worker or transport boundary settles.
          const message = await requestErrorMessage(error)
          if (controller.signal.aborted) return latestOutcome
          latestOutcome = {
            sessionId,
            sawCommandStarted: false,
            terminalEvent: null,
            transportError: message,
            transportStatus: requestErrorStatus(error),
          }
        }
        if ([403, 404, 410].includes(latestOutcome.transportStatus ?? 0)) return latestOutcome
      }
      return latestOutcome
    },
    [applySessionView, consumeStream, setActiveCommand, syncConversation],
  )

  // Native execution outlives the short Builder command. This read-only
  // subscription never owns command busy state or dispatches/replays an action.
  useEffect(() => {
    if (!observedSessionId || !observedRequestId) return
    const initialReceipt = store.get(difyBuilderSessionViewAtom)?.test_execution
    const settled = (receipt: SessionView['test_execution']) =>
      receipt?.status === 'terminal' && receipt.cancellation?.status !== 'cancelling'
    if (
      !initialReceipt ||
      initialReceipt.request_id !== observedRequestId ||
      (settled(initialReceipt) &&
        hasNativeResult(initialReceipt, store.get(difyBuilderConversationAtom)))
    )
      return
    const controller = new AbortController()
    let cursor = ''
    let observationError = ''
    const complete = (authoritativeProjection = false) => {
      const receipt = store.get(difyBuilderSessionViewAtom)?.test_execution
      return (
        settled(receipt) &&
        (receipt?.native_run_id
          ? hasNativeResult(receipt, store.get(difyBuilderConversationAtom))
          : authoritativeProjection)
      )
    }

    const hydrate = async (view: SessionView, observedAtStart: number) => {
      if (
        controller.signal.aborted ||
        store.get(difyBuilderActiveSessionIdAtom) !== observedSessionId ||
        store.get(difyBuilderSessionViewAtom)?.test_execution?.request_id !== observedRequestId
      )
        return
      applySessionView(view, observedAtStart)
      const items = store.get(difyBuilderConversationAtom)
      const afterSequence = (items[0]?.seq ?? 0) - 1
      if (hasConversationRange(items, afterSequence, view.conversation_last_seq)) return
      if (items.length)
        await syncConversationRange(
          observedSessionId,
          afterSequence,
          view.conversation_last_seq,
          controller,
        )
      else await syncConversation(observedSessionId, view.conversation_last_seq, controller)
    }
    const recover = async () => {
      const observedAtStart = nativeObservationRef.current
      const view = await getSession(observedSessionId, controller.signal)
      await hydrate(view, observedAtStart)
      if (
        !controller.signal.aborted &&
        observationError &&
        store.get(difyBuilderSessionLastErrorAtom) === observationError
      ) {
        setLastError('')
        observationError = ''
      }
      return complete()
    }
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let finishReconnect: (() => void) | undefined
    const reconnectDelay = () =>
      new Promise<void>((resolve) => {
        finishReconnect = resolve
        reconnectTimer = setTimeout(resolve, 1000)
      })
    const observe = async () => {
      let reconnect = false
      while (!controller.signal.aborted) {
        try {
          if (reconnect) {
            await reconnectDelay()
            if (controller.signal.aborted || (await recover())) return
          }
          const observedAtStart = nativeObservationRef.current
          const events = await getSessionStream(observedSessionId, controller.signal, cursor)
          for await (const event of events) {
            if (controller.signal.aborted) return
            if (event.event === 'native_execution') {
              if (
                event.data.session_id !== observedSessionId ||
                event.data.receipt.request_id !== observedRequestId
              )
                continue
              cursor = event.data.cursor
              const view = store.get(difyBuilderSessionViewAtom)
              if (
                view?.session_id !== observedSessionId ||
                view.test_execution?.request_id !== observedRequestId
              )
                return
              traceRef.current.append({ dir: 'in', kind: event.event, payload: event.data })
              const applied = applySessionView(
                { ...view, test_execution: event.data.receipt },
                'native',
              )
              // Native terminal state can commit before the Builder result row.
              // Recover the watermark once, but keep the stream until that exact
              // native run's durable terminal result has also been hydrated.
              if (applied && settled(event.data.receipt) && (await recover())) return
            } else if (event.event === 'command_finished') {
              if (event.data.session_id !== observedSessionId) continue
              const { command_id, post_canvas_action_id: _postCanvasActionId, ...view } = event.data
              await hydrate({ ...view, last_command_id: command_id }, observedAtStart)
              if (complete(true)) return
            } else if (event.event === 'conversation_item_appended') {
              if (event.data.session_id !== observedSessionId) continue
              setConversation((current) => mergeConversationPage(current, [event.data.item]))
              confirmLocalUserMessage(observedSessionId, [event.data.item])
              if (complete()) return
            } else if (event.event === 'error') {
              if (event.data.code !== 'timeout') setLastError(streamErrorMessage(event.data))
              break
            }
          }
        } catch (error) {
          if (controller.signal.aborted) return
          const message = await requestErrorMessage(error)
          if (controller.signal.aborted) return
          observationError = message
          setLastError(message)
          if ([403, 404, 410].includes(requestErrorStatus(error) ?? 0)) return
        }
        reconnect = true
      }
    }
    void observe()
    return () => {
      controller.abort()
      clearTimeout(reconnectTimer)
      finishReconnect?.()
    }
  }, [
    applySessionView,
    confirmLocalUserMessage,
    observedRequestId,
    observedSessionId,
    setConversation,
    setLastError,
    store,
    syncConversation,
    syncConversationRange,
  ])

  const runCommand = useCallback(
    async ({
      openStream,
      knownSessionId,
      expectTerminalEvent,
      startsSession = false,
      prepareDraft = true,
      trace,
    }: SessionCommandOptions) => {
      const startingView = store.get(difyBuilderSessionViewAtom)
      const startingVersion = startsSession
        ? 0
        : startingView && startingView.session_id === knownSessionId
          ? startingView.version
          : undefined
      abortRef.current?.abort()
      pendingRetestRef.current = null
      executionProgress.clear()
      reasoningBuffer.clear()
      streamingTurnBuffer.clear()
      const controller = new AbortController()
      abortRef.current = controller
      // Preparation takes the draft barrier synchronously, before the busy
      // projection makes the canvas read-only. It also drains in-flight saves.
      const preparation = prepareDraft ? prepareCommand?.(true, controller.signal) : undefined
      setIsBusy(true)
      setLastError('')
      store.set(difyBuilderSessionErrorCodeAtom, null)
      let commandStarted = false

      try {
        await preparation
        if (controller.signal.aborted) return false
        if (startsSession) {
          setActiveSessionId(null)
          setActiveCommand(null)
          setView(null)
          setConversation([])
          setConversationHasMore(false)
          setConversationLoading(false)
          setLocalUserMessage((current) => (current?.sessionId === null ? current : null))
          setRetryableMessage(null)
          runEvents?.reset()
          canvasCursorRef.current = undefined
          pendingMessageRef.current = null
          // A new session boundary must start with a fresh trace buffer; clear
          // it here (before the outbound session_start append below) so a
          // second start*() without an intervening reset() doesn't leave the
          // previous session's frames mixed into this session's export.
          traceRef.current.clear()
        }
        if (trace) traceRef.current.append({ dir: 'out', kind: trace.kind, payload: trace.payload })
        commandStarted = true
        const observedAtStart = nativeObservationRef.current
        const events = await openStream(controller.signal)
        if (controller.signal.aborted) return false
        const outcome = await consumeStream(events, controller, knownSessionId, observedAtStart)
        if (controller.signal.aborted) return false
        const sessionId = outcome.sessionId ?? knownSessionId
        const reconciledCommandSucceeded = (reconciled?: SessionStreamOutcome) => {
          if (
            reconciled?.terminalEvent !== 'command_finished' ||
            reconciled.stateApplied !== true ||
            reconciled.terminalRunStatus === 'failed' ||
            reconciled.terminalInterrupted === true ||
            startingVersion === undefined ||
            !outcome.commandId ||
            reconciled.finishedCommandId !== outcome.commandId
          )
            return false

          const reconciledVersion = reconciled.observedVersion ?? 0
          return (
            reconciledVersion > startingVersion &&
            reconciledVersion > (outcome.commandStartedVersion ?? startingVersion)
          )
        }

        if (outcome.transportError) {
          setLastError(outcome.transportError)
          const reconciled = sessionId
            ? await reconcileSession(sessionId, controller, true)
            : undefined
          if (reconciled?.stateApplied) {
            executionProgress.clear()
            reasoningBuffer.clear()
            streamingTurnBuffer.clear()
          }
          if (reconciledCommandSucceeded(reconciled)) {
            setLastError('')
            return true
          }
          if (!controller.signal.aborted) setLastError(outcome.transportError)
          return false
        }

        if (outcome.terminalEvent) {
          if (controller.signal.aborted) return false
          if (outcome.terminalEvent === 'error') {
            const reconciled = sessionId
              ? await reconcileSession(sessionId, controller, true)
              : undefined
            if (reconciled?.stateApplied) {
              executionProgress.clear()
              reasoningBuffer.clear()
              streamingTurnBuffer.clear()
            }
            if (
              outcome.terminalErrorCode === COMMAND_FINISHED_UNAVAILABLE_CODE &&
              reconciledCommandSucceeded(reconciled)
            ) {
              setLastError('')
              return true
            }
            setLastError(outcome.terminalError || 'Builder command failed.')
            return false
          }
          if (!sessionId) setLastError('Builder stream did not identify its session.')
          if (outcome.terminalRunStatus === 'failed') return false
          return Boolean(
            sessionId &&
            outcome.stateApplied &&
            outcome.commandId &&
            outcome.finishedCommandId === outcome.commandId,
          )
        }

        if (expectTerminalEvent) {
          setLastError(UNEXPECTED_EOF_ERROR)
          const reconciled = sessionId
            ? await reconcileSession(sessionId, controller, true)
            : undefined
          if (reconciled?.stateApplied) {
            executionProgress.clear()
            reasoningBuffer.clear()
            streamingTurnBuffer.clear()
          }
          if (reconciledCommandSucceeded(reconciled)) {
            setLastError('')
            return true
          }
          if (!controller.signal.aborted) setLastError(UNEXPECTED_EOF_ERROR)
          return false
        }

        if (!outcome.sawCommandStarted) {
          setLastError('Builder stream ended without a command handshake.')
          return false
        }
        return true
      } catch (error) {
        if (controller.signal.aborted) return false
        const message = await requestErrorMessage(error)
        const code = await requestErrorCode(error)
        if (controller.signal.aborted) return false
        store.set(difyBuilderSessionErrorCodeAtom, code)
        if (code === 'model_unavailable') {
          const queryClient = store.get(queryClientAtom)
          void queryClient.invalidateQueries({
            queryKey: consoleQuery.workspaces.current.defaultModel.get.queryKey({
              input: { query: { model_type: ModelTypeEnum.textGeneration } },
            }),
          })
          void queryClient.invalidateQueries({
            queryKey: consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryKey({
              input: { params: { model_type: ModelTypeEnum.textGeneration } },
            }),
          })
        }
        setLastError(message)
        const reconciled =
          commandStarted && knownSessionId
            ? await reconcileSession(knownSessionId, controller, true)
            : undefined
        if (reconciled?.stateApplied) {
          executionProgress.clear()
          reasoningBuffer.clear()
          streamingTurnBuffer.clear()
        }
        if (!controller.signal.aborted) setLastError(message)
        return false
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null
          runEvents?.finishCommand()
          setIsBusy(false)
        }
      }
    },
    [
      consumeStream,
      prepareCommand,
      executionProgress,
      reasoningBuffer,
      reconcileSession,
      runEvents,
      setActiveSessionId,
      setActiveCommand,
      setConversation,
      setConversationHasMore,
      setIsBusy,
      setLastError,
      setLocalUserMessage,
      setRetryableMessage,
      setConversationLoading,
      setView,
      store,
      streamingTurnBuffer,
    ],
  )

  const startFix = useCallback(
    (appId: string, failedRunId: string, modelConfig?: SessionModel) =>
      runCommand({
        startsSession: true,
        expectTerminalEvent: true,
        openStream: (signal) => createFixSession(appId, failedRunId, modelConfig, signal),
        trace: {
          kind: 'session_start',
          payload: { scenario: 'fix', app_id: appId, failed_run_id: failedRunId },
        },
      }),
    [runCommand],
  )

  const startChecklistFix = useCallback(
    (appId: string, checklistErrors: ChecklistErrorPayload[], modelConfig?: SessionModel) =>
      runCommand({
        startsSession: true,
        expectTerminalEvent: true,
        openStream: (signal) =>
          createChecklistFixSession(appId, checklistErrors, modelConfig, signal),
        trace: {
          kind: 'session_start',
          payload: { scenario: 'fix', app_id: appId, checklist_errors: checklistErrors },
        },
      }),
    [runCommand],
  )

  const startBuild = useCallback(
    async (appId: string, goalText: string, modelConfig?: SessionModel, deriveAppName = false) => {
      const started = await runCommand({
        startsSession: true,
        expectTerminalEvent: true,
        openStream: (signal) =>
          createBuildSession(appId, goalText, modelConfig, signal, deriveAppName),
        trace: {
          kind: 'session_start',
          payload: {
            scenario: 'build',
            app_id: appId,
            goal_text: goalText,
            derive_app_name: deriveAppName,
          },
        },
      })
      if (deriveAppName) {
        await store.get(queryClientAtom).invalidateQueries({
          queryKey: consoleQuery.apps.byAppId.get.queryKey({
            input: { params: { app_id: appId } },
          }),
        })
      }
      return started
    },
    [runCommand, store],
  )

  const startEdit = useCallback(
    (appId: string, goalText: string, modelConfig?: SessionModel) =>
      runCommand({
        startsSession: true,
        expectTerminalEvent: true,
        openStream: (signal) => createEditSession(appId, goalText, modelConfig, signal),
        trace: {
          kind: 'session_start',
          payload: { scenario: 'edit', app_id: appId, goal_text: goalText },
        },
      }),
    [runCommand],
  )

  const restore = useCallback(
    async (sessionId: string) => {
      const normalizedSessionId = sessionId.trim()
      if (!normalizedSessionId || store.get(difyBuilderSessionBusyAtom)) return false

      abortRef.current?.abort()
      pendingRetestRef.current = null
      executionProgress.clear()
      reasoningBuffer.clear()
      streamingTurnBuffer.clear()
      setConversationLoading(false)
      setLocalUserMessage(null)
      setRetryableMessage(null)
      pendingMessageRef.current = null
      const controller = new AbortController()
      abortRef.current = controller
      const preparation = prepareCommand?.(false, controller.signal)
      setIsBusy(true)
      setLastError('')
      store.set(difyBuilderSessionErrorCodeAtom, null)
      try {
        await preparation
        if (controller.signal.aborted) return false
        setActiveSessionId(normalizedSessionId)
        traceRef.current.append({
          dir: 'out',
          kind: 'session_restore',
          payload: { session_id: normalizedSessionId },
        })
        if (store.get(difyBuilderSessionViewAtom)?.session_id !== normalizedSessionId) {
          setConversation([])
          runEvents?.reset()
        }
        const outcome = await reconcileSession(normalizedSessionId, controller, true)
        if (controller.signal.aborted) return false
        if (outcome?.terminalEvent === 'command_finished') return outcome.stateApplied === true
        if (outcome?.terminalEvent === 'error') {
          setLastError(outcome.terminalError || 'Builder command failed.')
          return false
        }
        if ([403, 404, 410].includes(outcome?.transportStatus ?? 0))
          clearSession(normalizedSessionId)
        const message = outcome?.transportError || UNEXPECTED_EOF_ERROR
        setLastError(message)
        return false
      } catch (error) {
        if (!controller.signal.aborted) {
          const message = await requestErrorMessage(error)
          if (controller.signal.aborted) return false
          setLastError(message)
        }
        return false
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null
          runEvents?.finishCommand()
          setIsBusy(false)
        }
      }
    },
    [
      clearSession,
      prepareCommand,
      executionProgress,
      reasoningBuffer,
      reconcileSession,
      runEvents,
      setActiveSessionId,
      setConversation,
      setIsBusy,
      setLastError,
      setLocalUserMessage,
      setRetryableMessage,
      setConversationLoading,
      store,
      streamingTurnBuffer,
    ],
  )

  const loadOlderConversation = useCallback(async () => {
    const view = store.get(difyBuilderSessionViewAtom)
    const items = store.get(difyBuilderConversationAtom)
    const firstItem = items[0]
    if (
      !view ||
      !firstItem ||
      !store.get(difyBuilderConversationHasMoreAtom) ||
      store.get(difyBuilderConversationLoadingAtom) ||
      store.get(difyBuilderSessionBusyAtom)
    )
      return false

    const controller = new AbortController()
    abortRef.current = controller
    setConversationLoading(true)
    try {
      const page = await getSessionConversation(
        view.session_id,
        { before_seq: firstItem.seq, limit: 20 },
        controller.signal,
      )
      if (
        controller.signal.aborted ||
        store.get(difyBuilderSessionViewAtom)?.session_id !== view.session_id
      )
        return false
      const merged = mergeConversation(page.data, store.get(difyBuilderConversationAtom))
      setConversation(merged)
      confirmLocalUserMessage(view.session_id, page.data)
      runEvents?.restoreRun(view.session_id, merged)
      setConversationHasMore(page.has_more)
      return page.data.length > 0
    } catch (error) {
      const message = await requestErrorMessage(error)
      if (!controller.signal.aborted) setLastError(message)
      return false
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setConversationLoading(false)
    }
  }, [
    confirmLocalUserMessage,
    runEvents,
    setConversation,
    setConversationHasMore,
    setConversationLoading,
    setLastError,
    store,
  ])

  const refresh = useCallback(() => {
    const sessionId =
      store.get(difyBuilderActiveSessionIdAtom) ?? store.get(difyBuilderSessionViewAtom)?.session_id
    return sessionId ? restore(sessionId) : Promise.resolve(false)
  }, [restore, store])

  const continueRetest = useCallback(() => {
    const pending = pendingRetestRef.current
    if (!pending) return
    const view = store.get(difyBuilderSessionViewAtom)
    if (
      !view ||
      view.session_id !== pending.sessionId ||
      view.version !== pending.version ||
      view.app_revision?.current !== pending.appRevision ||
      view.app_revision?.conflicted
    ) {
      pendingRetestRef.current = null
      return
    }
    if (store.get(difyBuilderSessionBusyAtom) || !store.get(difyBuilderCanvasReadyAtom)) return
    // Consume before dispatch: duplicate refresh callbacks cannot start a second run.
    pendingRetestRef.current = null
    void runCommand({
      knownSessionId: pending.sessionId,
      expectTerminalEvent: true,
      openStream: (signal) =>
        runSessionAction(
          pending.sessionId,
          pending.actionId,
          {},
          pending.version,
          pending.appRevision,
          signal,
        ),
      trace: {
        kind: 'action',
        payload: { action_id: pending.actionId, payload: {}, base_version: pending.version },
      },
    })
  }, [runCommand, store])

  const onCanvasRefreshed = useCallback(() => {
    runEvents?.onCanvasRefreshed()
    continueRetest()
  }, [continueRetest, runEvents])

  const runAction = useCallback(
    async (
      actionId: string,
      payload: Record<string, unknown> = {},
      receiptSnapshot?: DifyBuilderReceiptSnapshot,
    ) => {
      const view = store.get(difyBuilderSessionViewAtom)
      if (!view || store.get(difyBuilderSessionBusyAtom)) return false
      const selectedId = actionId === 'confirm' ? payload.option_id : actionId
      const nativeControl =
        typeof selectedId === 'string' &&
        ['confirm_test_operation', 'deny_test_operation', 'resume_test', 'cancel_test'].includes(
          selectedId,
        )
      const selectedAction = view.actions?.find((action) => action.id === selectedId)
      if (nativeControl && !selectedAction) return false
      // Preserve explicit targets from the originating card: stale targets must
      // reach the backend guard rather than silently binding to a newer request.
      const actionPayload = { ...selectedAction?.payload, ...payload }
      let clientActionId: string | undefined
      if (nativeControl) {
        const signature = JSON.stringify([
          view.session_id,
          view.version,
          view.app_revision?.current,
          actionId,
          actionPayload,
          receiptSnapshot,
        ])
        if (pendingActionRef.current?.signature !== signature)
          pendingActionRef.current = { signature, id: globalThis.crypto.randomUUID() }
        clientActionId = pendingActionRef.current.id
      }
      const succeeded = await runCommand({
        knownSessionId: view.session_id,
        // These control an already admitted immutable attempt; do not save or
        // rewrite the canvas while approving, cancelling or resuming it.
        prepareDraft: !nativeControl,
        expectTerminalEvent: actionId !== 'update_model',
        openStream: (signal) =>
          runSessionAction(
            view.session_id,
            actionId,
            actionPayload,
            view.version,
            view.app_revision?.current ?? '',
            signal,
            receiptSnapshot,
            clientActionId,
          ),
        trace: {
          kind: 'action',
          payload: {
            action_id: actionId,
            payload: actionPayload,
            base_version: view.version,
            client_action_id: clientActionId,
          },
        },
      })
      // Also handles a refresh that completed before this command promise resumed.
      if (succeeded && pendingRetestRef.current) continueRetest()
      return succeeded
    },
    [continueRetest, runCommand, store],
  )

  const sendMessage = useCallback(
    async (text: string, requestedTurnId?: string) => {
      const view = store.get(difyBuilderSessionViewAtom)
      if (!view || store.get(difyBuilderSessionBusyAtom)) return false
      const normalizedText = text.trim()
      if (!normalizedText) return false
      const pending = pendingMessageRef.current
      const clientTurnId =
        requestedTurnId?.trim() ||
        (pending?.sessionId === view.session_id && pending.text === normalizedText
          ? pending.turnId
          : globalThis.crypto.randomUUID())
      const retryableMessage = store.get(difyBuilderRetryableMessageAtom)
      const retrying =
        retryableMessage?.sessionId === view.session_id && retryableMessage.turnId === clientTurnId
      if (!retrying) setRetryableMessage(null)
      pendingMessageRef.current = {
        sessionId: view.session_id,
        text: normalizedText,
        turnId: clientTurnId,
      }
      const userMessageCommitted = store
        .get(difyBuilderConversationAtom)
        .some((item) => item.kind === 'user' && item.payload.turn_id === clientTurnId)
      if (!userMessageCommitted) {
        setLocalUserMessage((current) =>
          current?.sessionId === view.session_id && current.turnId === clientTurnId
            ? current
            : {
                afterSequence: view.conversation_last_seq,
                localId: clientTurnId,
                sessionId: view.session_id,
                text: normalizedText,
                turnId: clientTurnId,
              },
        )
      }
      const sent = await runCommand({
        knownSessionId: view.session_id,
        expectTerminalEvent: true,
        openStream: (signal) =>
          sendSessionMessage(view.session_id, normalizedText, view.version, clientTurnId, signal),
        trace: {
          kind: 'message',
          payload: {
            text: normalizedText,
            base_version: view.version,
            client_turn_id: clientTurnId,
          },
        },
      })
      if (pendingMessageRef.current?.turnId === clientTurnId) {
        if (sent) {
          pendingMessageRef.current = null
          setRetryableMessage((current) => (current?.turnId === clientTurnId ? null : current))
        } else {
          setRetryableMessage({
            sessionId: view.session_id,
            text: normalizedText,
            turnId: clientTurnId,
          })
        }
      }
      return sent
    },
    [runCommand, setLocalUserMessage, setRetryableMessage, store],
  )

  const updateModel = useCallback(
    (modelConfig: SessionModel) => runAction('update_model', { model_config: modelConfig }),
    [runAction],
  )

  const reset = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    pendingRetestRef.current = null
    executionProgress.clear()
    reasoningBuffer.clear()
    streamingTurnBuffer.clear()
    pendingMessageRef.current = null
    setLocalUserMessage(null)
    setRetryableMessage(null)
    setActiveSessionId(null)
    setActiveCommand(null)
    setConversation([])
    setConversationHasMore(false)
    setConversationLoading(false)
    setView(null)
    setLastError('')
    store.set(difyBuilderSessionErrorCodeAtom, null)
    runEvents?.reset()
    canvasCursorRef.current = undefined
    traceRef.current.clear()
    setIsBusy(false)
  }, [
    executionProgress,
    reasoningBuffer,
    runEvents,
    setActiveSessionId,
    setActiveCommand,
    setConversation,
    setConversationHasMore,
    setConversationLoading,
    setIsBusy,
    setLastError,
    setLocalUserMessage,
    setRetryableMessage,
    setView,
    store,
    streamingTurnBuffer,
  ])

  const getTrace = useCallback(() => traceRef.current.snapshot(), [])

  return useMemo(
    () => ({
      startFix,
      startChecklistFix,
      startBuild,
      startEdit,
      loadOlderConversation,
      refresh,
      restore,
      runAction,
      sendMessage,
      updateModel,
      reset,
      getTrace,
      onCanvasRefreshed,
    }),
    [
      refresh,
      loadOlderConversation,
      reset,
      restore,
      runAction,
      sendMessage,
      startBuild,
      startChecklistFix,
      startEdit,
      startFix,
      updateModel,
      getTrace,
      onCanvasRefreshed,
    ],
  )
}
