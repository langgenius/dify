'use client'

import type {
  DifyBuilderCanvasEventData,
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
import { useSetAtom, useStore } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import { useCallback, useEffect, useEffectEvent, useMemo, useRef } from 'react'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { consoleQuery } from '@/service/console'
import { commonQueryKeys } from '@/service/use-common'
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
import {
  hasConversationRange,
  isCompletedView,
  mergeConversation,
  projectSessionView,
} from './projection'
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
    (nextView: SessionView) => {
      const activeSessionId = store.get(difyBuilderActiveSessionIdAtom)
      if (activeSessionId && activeSessionId !== nextView.session_id) return false

      const current = store.get(difyBuilderSessionViewAtom)
      const projected = projectSessionView(current, nextView)
      if (!projected) return false

      // Bounded JSON/SSE session projections replace metadata atomically;
      // durable conversation rows have their own paginated owner.
      setView(projected)
      const canvasCursor = canvasCursorRef.current
      if (
        canvasCursor &&
        (canvasCursor.session_id !== projected.session_id ||
          canvasCursor.at_version <= projected.version)
      )
        canvasCursorRef.current = undefined
      if (isCompletedView(projected)) {
        setActiveSessionId((sessionId) => (sessionId === projected.session_id ? null : sessionId))
      } else {
        setActiveSessionId(projected.session_id)
      }
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
        if (controller.signal.aborted) return false
        items = page.data.filter((item) => item.seq <= targetLastSeq)
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
        if (controller.signal.aborted) return false
        const boundedPage = page.data.filter((item) => item.seq <= targetLastSeq)
        const merged = mergeConversation(items, boundedPage)
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
        if (controller.signal.aborted) return false
        const boundedPage = page.data.filter((item) => item.seq <= targetLastSeq)
        const merged = mergeConversation(items, boundedPage)
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

        if (event.event === 'progress') {
          outcome.sessionId = event.data.session_id
          executionProgress.enqueue(event.data)
          return false
        }

        if (event.event === 'conversation_item_appended') {
          if (outcome.commandId && event.data.command_id !== outcome.commandId) return false
          outcome.sessionId = event.data.session_id
          if (store.get(difyBuilderActiveSessionIdAtom) !== event.data.session_id) return false
          setConversation((current) => mergeConversation(current, [event.data.item]))
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
          const stateApplied = applySessionView(stateView)
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
          const view = await getSession(sessionId, controller.signal)
          if (controller.signal.aborted) return latestOutcome
          const stateApplied = applySessionView(view)
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

          const events = await getSessionStream(sessionId, controller.signal)
          latestOutcome = await consumeStream(events, controller, sessionId)
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

  const runCommand = useCallback(
    async ({
      openStream,
      knownSessionId,
      expectTerminalEvent,
      startsSession = false,
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
      const preparation = prepareCommand?.(true, controller.signal)
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
        const events = await openStream(controller.signal)
        if (controller.signal.aborted) return false
        const outcome = await consumeStream(events, controller, knownSessionId)
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
            queryKey: commonQueryKeys.defaultModel(ModelTypeEnum.textGeneration),
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
        if (store.get(difyBuilderSessionViewAtom)?.session_id !== normalizedSessionId)
          runEvents?.reset()
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
    async (actionId: string, payload: Record<string, unknown> = {}) => {
      const view = store.get(difyBuilderSessionViewAtom)
      if (!view || store.get(difyBuilderSessionBusyAtom)) return false
      const succeeded = await runCommand({
        knownSessionId: view.session_id,
        expectTerminalEvent: actionId !== 'update_model',
        openStream: (signal) =>
          runSessionAction(
            view.session_id,
            actionId,
            payload,
            view.version,
            view.app_revision?.current ?? '',
            signal,
          ),
        trace: {
          kind: 'action',
          payload: { action_id: actionId, payload, base_version: view.version },
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
