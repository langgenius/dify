'use client'

import type {
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
  runSessionAction,
  sendSessionMessage,
} from './client'
import {
  requestErrorMessage,
  requestErrorStatus,
  streamErrorMessage,
  UNEXPECTED_EOF_ERROR,
} from './errors'
import { isTerminalView, projectCommit, projectSessionView } from './projection'
import {
  difyBuilderActiveSessionIdAtom,
  difyBuilderSessionBusyAtom,
  difyBuilderSessionLastCanvasEventAtom,
  difyBuilderSessionLastErrorAtom,
  difyBuilderSessionViewAtom,
} from './state'
import { useDifyBuilderStreamingTurnBuffer } from './use-streaming-turn-buffer'

/**
 * Owns the Dify Builder session lifecycle. Live commands render directly from
 * authoritative SSE snapshots, durable commits, and final state frames. Token
 * deltas use an isolated frame-buffered atom. GET is reserved for restore and
 * reconnect flows.
 */
export function useDifyBuilderSessionController(): DifyBuilderSessionController {
  const store = useStore()
  const setActiveSessionId = useSetAtom(difyBuilderActiveSessionIdAtom)
  const setView = useSetAtom(difyBuilderSessionViewAtom)
  const setLastError = useSetAtom(difyBuilderSessionLastErrorAtom)
  const setLastCanvasEvent = useSetAtom(difyBuilderSessionLastCanvasEventAtom)
  const setIsBusy = useSetAtom(difyBuilderSessionBusyAtom)
  const streamingTurnBuffer = useDifyBuilderStreamingTurnBuffer()
  const abortRef = useRef<AbortController | null>(null)
  const canvasEventIdRef = useRef(0)
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

      // Full server snapshots (GET, SSE snapshot, and SSE state) replace the
      // disposable in-memory projection atomically.
      setView(projected)
      if (isTerminalView(projected)) {
        setActiveSessionId((sessionId) => (sessionId === projected.session_id ? null : sessionId))
      } else {
        setActiveSessionId(projected.session_id)
      }
      return true
    },
    [setActiveSessionId, setView, store],
  )

  const applyCommit = useCallback(
    (commit: DifyBuilderCommitEventData) => {
      const activeSessionId = store.get(difyBuilderActiveSessionIdAtom)
      if (activeSessionId && activeSessionId !== commit.session_id) return

      const current = store.get(difyBuilderSessionViewAtom)
      const projected = projectCommit(current, commit)
      if (!projected) return
      setView(projected)
      streamingTurnBuffer.clearThroughVersion(commit.session_id, commit.version)
    },
    [setView, store, streamingTurnBuffer],
  )

  const clearSession = useCallback(
    (sessionId: string) => {
      setActiveSessionId((current) => (current === sessionId ? null : current))
      setView((current) => (current?.session_id === sessionId ? null : current))
      streamingTurnBuffer.clear()
    },
    [setActiveSessionId, setView, streamingTurnBuffer],
  )

  const consumeStream = useCallback(
    async (
      events: AsyncIterable<DifyBuilderStreamEventResponse>,
      controller: AbortController,
      initialSessionId?: string,
      stopWhenNotExecuting = false,
    ): Promise<SessionStreamOutcome> => {
      const outcome: SessionStreamOutcome = {
        sessionId: initialSessionId,
        sawSnapshot: false,
        terminalEvent: null,
      }
      const handleEvent = (event: DifyBuilderStreamEventResponse): boolean => {
        if (event.event === 'snapshot') {
          outcome.sawSnapshot = true
          outcome.sessionId = event.data.session_id
          const stateApplied = applySessionView(event.data)
          if (stateApplied) streamingTurnBuffer.clear()
          if (stopWhenNotExecuting && event.data.run_status !== 'executing') {
            outcome.terminalEvent = 'state'
            outcome.stateApplied = stateApplied
            return true
          }
          return false
        }

        if (event.event === 'canvas') {
          canvasEventIdRef.current += 1
          setLastCanvasEvent({ id: canvasEventIdRef.current, data: event.data })
          return false
        }

        if (event.event === 'commit') {
          outcome.sessionId = event.data.session_id
          applyCommit(event.data)
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
          outcome.stateApplied = applySessionView(stateView)
          if (outcome.stateApplied) streamingTurnBuffer.clear()
          return true
        }

        if (event.event === 'error') {
          outcome.terminalEvent = 'error'
          outcome.terminalError = streamErrorMessage(event.data)
          streamingTurnBuffer.clear()
          setLastError(outcome.terminalError)
          return true
        }
        return false
      }

      try {
        for await (const event of events) {
          if (controller.signal.aborted || handleEvent(event)) break
        }
      } catch (error) {
        if (!controller.signal.aborted) outcome.transportError = requestErrorMessage(error)
      }

      return outcome
    },
    [applyCommit, applySessionView, setLastCanvasEvent, setLastError, streamingTurnBuffer],
  )

  const reconcileSession = useCallback(
    async (sessionId: string, controller: AbortController) => {
      try {
        const events = await getSession(sessionId, controller.signal)
        return await consumeStream(events, controller, sessionId, true)
      } catch {
        return undefined
      }
    },
    [consumeStream],
  )

  const runCommand = useCallback(
    async ({
      openStream,
      knownSessionId,
      expectTerminalEvent,
      startsSession = false,
    }: SessionCommandOptions) => {
      abortRef.current?.abort()
      streamingTurnBuffer.clear()
      const controller = new AbortController()
      abortRef.current = controller
      setIsBusy(true)
      setLastError('')
      if (startsSession) {
        setActiveSessionId(null)
        setLastCanvasEvent(null)
        pendingMessageRef.current = null
      }

      try {
        const events = await openStream(controller.signal)
        if (controller.signal.aborted) return false
        const outcome = await consumeStream(events, controller, knownSessionId)
        if (controller.signal.aborted) return false
        const sessionId = outcome.sessionId ?? knownSessionId

        if (outcome.transportError) {
          streamingTurnBuffer.clear()
          setLastError(outcome.transportError)
          if (sessionId) await reconcileSession(sessionId, controller)
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
          return Boolean(sessionId && outcome.stateApplied)
        }

        if (expectTerminalEvent) {
          streamingTurnBuffer.clear()
          setLastError(UNEXPECTED_EOF_ERROR)
          if (sessionId) await reconcileSession(sessionId, controller)
          if (!controller.signal.aborted) setLastError(UNEXPECTED_EOF_ERROR)
          return false
        }

        if (!outcome.sawSnapshot) {
          setLastError('Builder stream ended without a snapshot.')
          return false
        }
        return true
      } catch (error) {
        if (controller.signal.aborted) return false
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
      reconcileSession,
      setActiveSessionId,
      setIsBusy,
      setLastCanvasEvent,
      setLastError,
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

      streamingTurnBuffer.clear()
      const controller = new AbortController()
      abortRef.current = controller
      setActiveSessionId(normalizedSessionId)
      setIsBusy(true)
      setLastError('')
      try {
        const events = await getSession(normalizedSessionId, controller.signal)
        const outcome = await consumeStream(events, controller, normalizedSessionId, true)
        if (controller.signal.aborted) return false
        if (outcome.terminalEvent === 'state') return outcome.stateApplied === true
        if (outcome.terminalEvent === 'error') {
          setLastError(outcome.terminalError || 'Builder command failed.')
          return false
        }
        if (!outcome.sawSnapshot) {
          setLastError(outcome.transportError || 'Builder stream ended without a snapshot.')
          return false
        }

        const reconciled = await reconcileSession(normalizedSessionId, controller)
        if (controller.signal.aborted) return false
        if (reconciled?.terminalEvent === 'state' && reconciled.stateApplied) return true
        const message = outcome.transportError || UNEXPECTED_EOF_ERROR
        setLastError(message)
        return false
      } catch (error) {
        if (!controller.signal.aborted) {
          const message = requestErrorMessage(error)
          if ([403, 404, 410].includes(requestErrorStatus(error) ?? 0))
            clearSession(normalizedSessionId)
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
      consumeStream,
      clearSession,
      reconcileSession,
      setActiveSessionId,
      setIsBusy,
      setLastError,
      store,
      streamingTurnBuffer,
    ],
  )

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
    streamingTurnBuffer.clear()
    pendingMessageRef.current = null
    setActiveSessionId(null)
    setView(null)
    setLastError('')
    setLastCanvasEvent(null)
    setIsBusy(false)
  }, [
    setActiveSessionId,
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
      refresh,
      restore,
      runAction,
      sendMessage,
      updateModel,
      reset,
    }),
    [
      refresh,
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
