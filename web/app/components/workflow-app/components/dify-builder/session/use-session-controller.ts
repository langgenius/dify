'use client'

import type {
  CanvasEventData,
  DifyBuilderCommitEventData,
  DifyBuilderStreamEventResponse,
} from '@dify/contracts/api/console/dify-builder/types.gen'
import type {
  ChecklistErrorPayload,
  DifyBuilderSessionController,
  SessionModel,
  SessionView,
} from '../types'
import type { SessionCommandOptions, SessionStreamOutcome } from './types'
import { useSetAtom, useStore } from 'jotai'
import { useCallback, useEffect, useMemo, useRef } from 'react'
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
  requestErrorMessage,
  requestErrorStatus,
  streamErrorMessage,
  UNEXPECTED_EOF_ERROR,
} from './errors'
import { isCompletedView, mergeConversation, projectCommit, projectSessionView } from './projection'
import {
  difyBuilderActiveSessionIdAtom,
  difyBuilderConversationAtom,
  difyBuilderConversationHasMoreAtom,
  difyBuilderConversationLoadingAtom,
  difyBuilderSessionBusyAtom,
  difyBuilderSessionLastCanvasEventAtom,
  difyBuilderSessionLastErrorAtom,
  difyBuilderSessionViewAtom,
} from './state'
import { useDifyBuilderExecutionProgress } from './use-execution-progress'
import { useDifyBuilderReasoningBuffer } from './use-reasoning-buffer'
import { useDifyBuilderStreamingTurnBuffer } from './use-streaming-turn-buffer'

const MAX_RECONCILE_ATTEMPTS = 3
const isActiveRunStatus = (status: SessionView['run_status']) => status === 'processing'
const isActiveView = (view: SessionView) => isActiveRunStatus(view.run_status) && !view.interrupted

/**
 * Owns the Dify Builder session lifecycle. Live commands render directly from
 * bounded command/state SSE events, durable commits, and paginated JSON
 * history. Token deltas use an isolated frame-buffered atom. GET owns initial
 * restore and repairs any sequence gap left by a dropped commit event.
 */
export function useDifyBuilderSessionController(): DifyBuilderSessionController {
  const store = useStore()
  const setActiveSessionId = useSetAtom(difyBuilderActiveSessionIdAtom)
  const setConversation = useSetAtom(difyBuilderConversationAtom)
  const setConversationHasMore = useSetAtom(difyBuilderConversationHasMoreAtom)
  const setConversationLoading = useSetAtom(difyBuilderConversationLoadingAtom)
  const setView = useSetAtom(difyBuilderSessionViewAtom)
  const setLastError = useSetAtom(difyBuilderSessionLastErrorAtom)
  const setLastCanvasEvent = useSetAtom(difyBuilderSessionLastCanvasEventAtom)
  const setIsBusy = useSetAtom(difyBuilderSessionBusyAtom)
  const executionProgress = useDifyBuilderExecutionProgress()
  const reasoningBuffer = useDifyBuilderReasoningBuffer()
  const streamingTurnBuffer = useDifyBuilderStreamingTurnBuffer()
  const abortRef = useRef<AbortController | null>(null)
  const canvasEventIdRef = useRef(0)
  const canvasCursorRef = useRef<
    Pick<CanvasEventData, 'at_version' | 'operation_id' | 'revision' | 'session_id'> | undefined
  >(undefined)
  const pendingMessageRef = useRef<{ sessionId: string; text: string; turnId: string } | null>(null)

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [])

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
        if (!page.has_more) break
      }
      return lastSeq >= targetLastSeq
    },
    [setConversation, setConversationHasMore, store],
  )

  const applyCommit = useCallback(
    (commit: DifyBuilderCommitEventData) => {
      const activeSessionId = store.get(difyBuilderActiveSessionIdAtom)
      if (activeSessionId && activeSessionId !== commit.session_id) return undefined

      const current = store.get(difyBuilderSessionViewAtom)
      const projected = projectCommit(current, commit)
      if (!projected) return undefined
      const conversation = store.get(difyBuilderConversationAtom)
      const lastSequence = conversation.at(-1)?.seq ?? -1
      const newSequences = commit.items
        .map((item) => item.seq)
        .filter((sequence) => sequence > lastSequence)
        .sort((left, right) => left - right)
      let expectedSequence = lastSequence + 1
      const hasConversationGap = newSequences.some((sequence) => {
        const hasGap = sequence > expectedSequence
        expectedSequence = sequence + 1
        return hasGap
      })
      setView(projected)
      if (!hasConversationGap) setConversation(mergeConversation(conversation, commit.items))
      if (
        canvasCursorRef.current?.session_id === commit.session_id &&
        canvasCursorRef.current.at_version <= commit.version
      )
        canvasCursorRef.current = undefined
      executionProgress.clearThroughVersion(commit.session_id, commit.version)
      reasoningBuffer.clearThroughVersion(commit.session_id, commit.version)
      streamingTurnBuffer.clearThroughVersion(commit.session_id, commit.version)
      return hasConversationGap ? newSequences.at(-1) : undefined
    },
    [executionProgress, reasoningBuffer, setConversation, setView, store, streamingTurnBuffer],
  )

  const clearSession = useCallback(
    (sessionId: string) => {
      setActiveSessionId((current) => (current === sessionId ? null : current))
      setView((current) => (current?.session_id === sessionId ? null : current))
      setConversation([])
      setConversationHasMore(false)
      executionProgress.clear()
      reasoningBuffer.clear()
      streamingTurnBuffer.clear()
    },
    [
      executionProgress,
      reasoningBuffer,
      setActiveSessionId,
      setConversation,
      setConversationHasMore,
      setView,
      streamingTurnBuffer,
    ],
  )

  const consumeStream = useCallback(
    async (
      events: AsyncIterable<DifyBuilderStreamEventResponse>,
      controller: AbortController,
      initialSessionId?: string,
      stopWhenNotActive = false,
    ): Promise<SessionStreamOutcome> => {
      const outcome: SessionStreamOutcome = {
        sessionId: initialSessionId,
        sawCommandStarted: false,
        terminalEvent: null,
      }
      const handleEvent = async (event: DifyBuilderStreamEventResponse): Promise<boolean> => {
        if (event.event === 'command_started') {
          outcome.sawCommandStarted = true
          outcome.sessionId = event.data.session_id
          outcome.commandStartedVersion = event.data.version
          outcome.observedVersion = Math.max(outcome.observedVersion ?? 0, event.data.version)
          const { kind: _kind, ...stateView } = event.data
          const stateApplied = applySessionView(stateView)
          if (stateApplied) {
            executionProgress.clear()
            reasoningBuffer.clear()
            streamingTurnBuffer.clear()
          }
          const historyApplied = await syncConversation(
            stateView.session_id,
            stateView.conversation_last_seq,
            controller,
          )
          if (stopWhenNotActive && !isActiveView(stateView)) {
            outcome.terminalEvent = 'state'
            outcome.terminalInterrupted = stateView.interrupted
            outcome.terminalRunStatus = stateView.run_status
            outcome.stateApplied = stateApplied && historyApplied
            return true
          }
          return false
        }

        if (event.event === 'canvas') {
          const view = store.get(difyBuilderSessionViewAtom)
          const cursor = canvasCursorRef.current
          if (
            store.get(difyBuilderActiveSessionIdAtom) !== event.data.session_id ||
            view?.session_id !== event.data.session_id ||
            view.version >= event.data.at_version ||
            (cursor?.session_id === event.data.session_id &&
              (cursor.at_version > event.data.at_version ||
                (cursor.at_version === event.data.at_version &&
                  cursor.operation_id === event.data.operation_id &&
                  cursor.revision >= event.data.revision)))
          )
            return false

          canvasCursorRef.current = event.data
          canvasEventIdRef.current += 1
          setLastCanvasEvent({ id: canvasEventIdRef.current, data: event.data })
          return false
        }

        if (event.event === 'node') {
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

        if (event.event === 'commit') {
          outcome.sessionId = event.data.session_id
          outcome.observedCommitVersion = Math.max(
            outcome.observedCommitVersion ?? 0,
            event.data.version,
          )
          outcome.observedVersion = Math.max(outcome.observedVersion ?? 0, event.data.version)
          const missingConversationTarget = applyCommit(event.data)
          if (missingConversationTarget !== undefined) {
            await syncConversation(event.data.session_id, missingConversationTarget, controller)
          }
          return false
        }

        if (event.event === 'agent_message') {
          outcome.sessionId = event.data.session_id
          streamingTurnBuffer.enqueue(event.data)
          return false
        }

        if (event.event === 'state') {
          outcome.terminalEvent = 'state'
          outcome.sessionId = event.data.session_id
          const { kind: _kind, ...stateView } = event.data
          outcome.observedVersion = Math.max(outcome.observedVersion ?? 0, stateView.version)
          outcome.terminalInterrupted = stateView.interrupted
          outcome.terminalRunStatus = stateView.run_status
          const stateApplied = applySessionView(stateView)
          if (stateApplied) {
            executionProgress.clear()
            reasoningBuffer.clear()
            streamingTurnBuffer.clear()
          }
          const historyApplied = await syncConversation(
            stateView.session_id,
            stateView.conversation_last_seq,
            controller,
          )
          outcome.stateApplied = stateApplied && historyApplied
          return true
        }

        if (event.event === 'error') {
          outcome.terminalEvent = 'error'
          outcome.terminalError = streamErrorMessage(event.data)
          executionProgress.clear()
          reasoningBuffer.clear()
          streamingTurnBuffer.clear()
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
          outcome.transportError = requestErrorMessage(error)
          outcome.transportStatus = requestErrorStatus(error)
        }
      }

      return outcome
    },
    [
      applyCommit,
      applySessionView,
      executionProgress,
      reasoningBuffer,
      setLastCanvasEvent,
      setLastError,
      store,
      syncConversation,
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
          const stateApplied = applySessionView(view)
          const historyApplied = await syncConversation(
            sessionId,
            view.conversation_last_seq,
            controller,
            replaceConversation && attempt === 0,
          )
          latestOutcome = {
            sessionId,
            sawCommandStarted: false,
            terminalEvent: isActiveView(view) ? null : 'state',
            terminalInterrupted: view.interrupted,
            terminalRunStatus: view.run_status,
            observedVersion: view.version,
            stateApplied: stateApplied && historyApplied,
          }
          if (!isActiveView(view)) return latestOutcome

          const events = await getSessionStream(sessionId, controller.signal)
          latestOutcome = await consumeStream(events, controller, sessionId, true)
          if (latestOutcome.terminalEvent === 'state') return latestOutcome
        } catch (error) {
          // A reconnect is best-effort. A later attempt may observe the
          // durable state after a worker or transport boundary settles.
          latestOutcome = {
            sessionId,
            sawCommandStarted: false,
            terminalEvent: null,
            transportError: requestErrorMessage(error),
            transportStatus: requestErrorStatus(error),
          }
        }
        if ([403, 404, 410].includes(latestOutcome.transportStatus ?? 0)) return latestOutcome
      }
      return latestOutcome
    },
    [applySessionView, consumeStream, syncConversation],
  )

  const runCommand = useCallback(
    async ({
      openStream,
      knownSessionId,
      expectTerminalEvent,
      startsSession = false,
    }: SessionCommandOptions) => {
      const startingView = store.get(difyBuilderSessionViewAtom)
      const startingVersion = startsSession
        ? 0
        : startingView && startingView.session_id === knownSessionId
          ? startingView.version
          : undefined
      abortRef.current?.abort()
      executionProgress.clear()
      reasoningBuffer.clear()
      streamingTurnBuffer.clear()
      const controller = new AbortController()
      abortRef.current = controller
      setIsBusy(true)
      setLastError('')
      if (startsSession) {
        setActiveSessionId(null)
        setConversation([])
        setConversationHasMore(false)
        setLastCanvasEvent(null)
        canvasCursorRef.current = undefined
        pendingMessageRef.current = null
      }

      try {
        const events = await openStream(controller.signal)
        if (controller.signal.aborted) return false
        const outcome = await consumeStream(events, controller, knownSessionId)
        if (controller.signal.aborted) return false
        const sessionId = outcome.sessionId ?? knownSessionId
        const reconciledCommandSucceeded = (reconciled?: SessionStreamOutcome) => {
          if (
            reconciled?.terminalEvent !== 'state' ||
            reconciled.stateApplied !== true ||
            reconciled.terminalRunStatus === 'failed' ||
            reconciled.terminalInterrupted === true ||
            startingVersion === undefined
          )
            return false

          const reconciledVersion = reconciled.observedVersion ?? 0
          if (outcome.observedCommitVersion !== undefined)
            return (
              outcome.observedCommitVersion > startingVersion &&
              reconciledVersion >= outcome.observedCommitVersion
            )

          // A later GET version on an existing session may belong to another
          // client. Only a commit observed on this command stream can prove
          // that this command advanced the durable session.
          if (!startsSession) return false
          return reconciledVersion > Math.max(startingVersion, outcome.commandStartedVersion ?? 0)
        }

        if (outcome.transportError) {
          executionProgress.clear()
          reasoningBuffer.clear()
          streamingTurnBuffer.clear()
          setLastError(outcome.transportError)
          const reconciled = sessionId ? await reconcileSession(sessionId, controller) : undefined
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
            if (sessionId) await reconcileSession(sessionId, controller)
            setLastError(outcome.terminalError || 'Builder command failed.')
            return false
          }
          if (!sessionId) setLastError('Builder stream did not identify its session.')
          if (outcome.terminalRunStatus === 'failed') return false
          return Boolean(sessionId && outcome.stateApplied)
        }

        if (expectTerminalEvent) {
          executionProgress.clear()
          reasoningBuffer.clear()
          streamingTurnBuffer.clear()
          setLastError(UNEXPECTED_EOF_ERROR)
          const reconciled = sessionId ? await reconcileSession(sessionId, controller) : undefined
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
        executionProgress.clear()
        reasoningBuffer.clear()
        streamingTurnBuffer.clear()
        const message = requestErrorMessage(error)
        setLastError(message)
        if (knownSessionId) await reconcileSession(knownSessionId, controller)
        if (!controller.signal.aborted) setLastError(message)
        return false
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null
          setIsBusy(false)
        }
      }
    },
    [
      consumeStream,
      executionProgress,
      reasoningBuffer,
      reconcileSession,
      setActiveSessionId,
      setConversation,
      setConversationHasMore,
      setIsBusy,
      setLastCanvasEvent,
      setLastError,
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
      }),
    [runCommand],
  )

  const startBuild = useCallback(
    (appId: string, goalText: string, modelConfig?: SessionModel) =>
      runCommand({
        startsSession: true,
        expectTerminalEvent: true,
        openStream: (signal) => createBuildSession(appId, goalText, modelConfig, signal),
      }),
    [runCommand],
  )

  const startEdit = useCallback(
    (appId: string, goalText: string, modelConfig?: SessionModel) =>
      runCommand({
        startsSession: true,
        expectTerminalEvent: true,
        openStream: (signal) => createEditSession(appId, goalText, modelConfig, signal),
      }),
    [runCommand],
  )

  const restore = useCallback(
    async (sessionId: string) => {
      const normalizedSessionId = sessionId.trim()
      if (!normalizedSessionId || store.get(difyBuilderSessionBusyAtom)) return false

      abortRef.current?.abort()
      executionProgress.clear()
      reasoningBuffer.clear()
      streamingTurnBuffer.clear()
      setConversationLoading(false)
      const controller = new AbortController()
      abortRef.current = controller
      setActiveSessionId(normalizedSessionId)
      setIsBusy(true)
      setLastError('')
      try {
        const outcome = await reconcileSession(normalizedSessionId, controller, true)
        if (controller.signal.aborted) return false
        if (outcome?.terminalEvent === 'state') return outcome.stateApplied === true
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
          const message = requestErrorMessage(error)
          setLastError(message)
        }
        return false
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null
          setIsBusy(false)
        }
      }
    },
    [
      clearSession,
      executionProgress,
      reasoningBuffer,
      reconcileSession,
      setActiveSessionId,
      setIsBusy,
      setLastError,
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
      setConversation((current) => mergeConversation(page.data, current))
      setConversationHasMore(page.has_more)
      return page.data.length > 0
    } catch (error) {
      if (!controller.signal.aborted) setLastError(requestErrorMessage(error))
      return false
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setConversationLoading(false)
    }
  }, [setConversation, setConversationHasMore, setConversationLoading, setLastError, store])

  const refresh = useCallback(() => {
    const sessionId =
      store.get(difyBuilderActiveSessionIdAtom) ?? store.get(difyBuilderSessionViewAtom)?.session_id
    return sessionId ? restore(sessionId) : Promise.resolve(false)
  }, [restore, store])

  const runAction = useCallback(
    (actionId: string, payload: Record<string, unknown> = {}) => {
      const view = store.get(difyBuilderSessionViewAtom)
      if (!view || store.get(difyBuilderSessionBusyAtom)) return Promise.resolve(false)
      return runCommand({
        knownSessionId: view.session_id,
        expectTerminalEvent: actionId !== 'update_model' && actionId !== 'view_changes',
        openStream: (signal) =>
          runSessionAction(
            view.session_id,
            actionId,
            payload,
            view.version,
            view.app_revision?.current ?? '',
            signal,
          ),
      })
    },
    [runCommand, store],
  )

  const sendMessage = useCallback(
    async (text: string) => {
      const view = store.get(difyBuilderSessionViewAtom)
      if (!view || store.get(difyBuilderSessionBusyAtom)) return false
      const normalizedText = text.trim()
      if (!normalizedText) return false
      const pending = pendingMessageRef.current
      const clientTurnId =
        pending?.sessionId === view.session_id && pending.text === normalizedText
          ? pending.turnId
          : globalThis.crypto.randomUUID()
      pendingMessageRef.current = {
        sessionId: view.session_id,
        text: normalizedText,
        turnId: clientTurnId,
      }
      const sent = await runCommand({
        knownSessionId: view.session_id,
        expectTerminalEvent: true,
        openStream: (signal) =>
          sendSessionMessage(view.session_id, normalizedText, view.version, clientTurnId, signal),
      })
      if (sent && pendingMessageRef.current?.turnId === clientTurnId)
        pendingMessageRef.current = null
      return sent
    },
    [runCommand, store],
  )

  const updateModel = useCallback(
    (modelConfig: SessionModel) => runAction('update_model', { model_config: modelConfig }),
    [runAction],
  )

  const reset = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    executionProgress.clear()
    reasoningBuffer.clear()
    streamingTurnBuffer.clear()
    pendingMessageRef.current = null
    setActiveSessionId(null)
    setConversation([])
    setConversationHasMore(false)
    setConversationLoading(false)
    setView(null)
    setLastError('')
    setLastCanvasEvent(null)
    canvasCursorRef.current = undefined
    setIsBusy(false)
  }, [
    executionProgress,
    reasoningBuffer,
    setActiveSessionId,
    setConversation,
    setConversationHasMore,
    setConversationLoading,
    setIsBusy,
    setLastCanvasEvent,
    setLastError,
    setView,
    streamingTurnBuffer,
  ])

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
    ],
  )
}
