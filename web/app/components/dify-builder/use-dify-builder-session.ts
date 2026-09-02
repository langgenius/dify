'use client'

import type {
  AgentMessageEventData,
  DifyBuilderCommitEventData,
  DifyBuilderErrorResponse,
  DifyBuilderStreamEventResponse,
  SessionModel,
} from '@dify/contracts/api/console/dify-builder/types.gen'
import type { ChecklistErrorPayload, ConversationItem, ProgressEntry, SessionView } from './types'
import { useAtomValue, useSetAtom, useStore } from 'jotai'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { consoleClient } from '@/service/client'
import {
  difyBuilderActiveSessionIdAtom,
  difyBuilderSessionBusyAtom,
  difyBuilderSessionLastCanvasEventAtom,
  difyBuilderSessionLastErrorAtom,
  difyBuilderSessionLastRawAtom,
  difyBuilderSessionProgressLogAtom,
  difyBuilderSessionViewAtom,
} from './state'
import { DIFY_BUILDER_PROGRESS_LOG_LIMIT } from './types'

export type UseDifyBuilderSessionResult = {
  view: SessionView | null
  isBusy: boolean
  lastRaw: unknown
  lastError: string
  progressLog: ProgressEntry[]
  /** Creates a new Fix session for `failedRunId` and streams its progress. */
  startFix: (appId: string, failedRunId: string, modelConfig?: SessionModel) => Promise<boolean>
  /** Creates a new checklist-fix session for `checklistErrors` and streams its progress. */
  startChecklistFix: (
    appId: string,
    checklistErrors: ChecklistErrorPayload[],
    modelConfig?: SessionModel,
  ) => Promise<boolean>
  /** Creates a new Build session and streams the opening goal command. */
  startBuild: (appId: string, goalText: string, modelConfig?: SessionModel) => Promise<boolean>
  /** Creates an Edit session and streams the opening edit goal command. */
  startEdit: (appId: string, goalText: string, modelConfig?: SessionModel) => Promise<boolean>
  /** Re-fetches the current session (GET). No-op if no session has been created yet. */
  refresh: () => Promise<boolean>
  /** Restores a session and its full conversation from the authoritative GET endpoint. */
  restore: (sessionId: string) => Promise<boolean>
  /** Posts and streams an action (`approve_repair`, `run_verify`, ...). */
  runAction: (actionId: string, payload?: Record<string, unknown>) => Promise<boolean>
  /** Posts and streams a free-text message against the current session. */
  sendMessage: (text: string) => Promise<boolean>
  /** Persists a model selection on an idle/waiting session. */
  updateModel: (modelConfig: SessionModel) => Promise<boolean>
  /** Clears the local session without deleting server-side history. */
  reset: () => void
}

export type DifyBuilderSessionController = Omit<
  UseDifyBuilderSessionResult,
  'view' | 'isBusy' | 'lastRaw' | 'lastError' | 'progressLog'
>

type CommandOptions = {
  openStream: (signal: AbortSignal) => Promise<AsyncIterable<DifyBuilderStreamEventResponse>>
  knownSessionId?: string
  expectTerminalEvent: boolean
  startsSession?: boolean
}

type StreamOutcome = {
  sessionId?: string
  sawSnapshot: boolean
  terminalEvent: 'state' | 'error' | null
  terminalError?: string
  transportError?: string
  stateApplied?: boolean
}

const UNEXPECTED_EOF_ERROR = 'Builder stream ended before a terminal event.'

const isTerminalView = (view: SessionView) =>
  view.run_status === 'complete' || view.run_status === 'failed'

function requestErrorMessage(error: unknown): string {
  const status = requestErrorStatus(error)
  if (typeof error === 'object' && error !== null && 'data' in error) {
    const data = error.data
    const body = typeof data === 'object' && data !== null && 'body' in data ? data.body : data
    const response = body as Partial<DifyBuilderErrorResponse> | undefined
    if (typeof response?.code === 'string')
      return status ? `HTTP ${status}: ${response.code}` : response.code
  }
  return error instanceof Error ? error.message : String(error)
}

function requestErrorStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  if ('status' in error && typeof error.status === 'number') return error.status
  if ('data' in error) {
    const data = error.data
    if (typeof data === 'object' && data !== null && 'status' in data)
      return typeof data.status === 'number' ? data.status : undefined
  }
}

function streamErrorMessage(
  data: Extract<DifyBuilderStreamEventResponse, { event: 'error' }>['data'],
) {
  if (typeof data.error === 'string') return data.error
  if (typeof data.message === 'string') return data.message
  if (typeof data.code === 'string') return data.code
  return 'Builder command failed.'
}

function mergeConversation(
  current: ConversationItem[],
  committed: ConversationItem[],
): ConversationItem[] {
  const bySequence = new Map(current.map((item) => [item.seq, item]))
  committed.forEach((item) => bySequence.set(item.seq, item))
  return [...bySequence.values()].sort((left, right) => left.seq - right.seq)
}

/**
 * Owns the Dify Builder session lifecycle. Live commands render directly from
 * authoritative SSE snapshots, durable commits, assistant deltas, and final
 * state frames. GET is reserved for restore/reconnect flows.
 */
export function useDifyBuilderSessionController(): DifyBuilderSessionController {
  const store = useStore()
  const setActiveSessionId = useSetAtom(difyBuilderActiveSessionIdAtom)
  const setView = useSetAtom(difyBuilderSessionViewAtom)
  const setLastRaw = useSetAtom(difyBuilderSessionLastRawAtom)
  const setLastError = useSetAtom(difyBuilderSessionLastErrorAtom)
  const setProgressLog = useSetAtom(difyBuilderSessionProgressLogAtom)
  const setLastCanvasEvent = useSetAtom(difyBuilderSessionLastCanvasEventAtom)
  const setIsBusy = useSetAtom(difyBuilderSessionBusyAtom)
  const abortRef = useRef<AbortController | null>(null)
  const progressIdRef = useRef(0)
  const canvasEventIdRef = useRef(0)
  const pendingMessageRef = useRef<{ sessionId: string; text: string; turnId: string } | null>(null)

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [])

  const pushProgress = useCallback(
    (event: string, data: unknown) => {
      progressIdRef.current += 1
      const entry = { id: progressIdRef.current, event, data }
      setProgressLog((previous) => {
        if (previous.length < DIFY_BUILDER_PROGRESS_LOG_LIMIT) return [...previous, entry]
        return [...previous.slice(1), entry]
      })
    },
    [setProgressLog],
  )

  const applySessionView = useCallback(
    (nextView: SessionView) => {
      const activeSessionId = store.get(difyBuilderActiveSessionIdAtom)
      if (activeSessionId && activeSessionId !== nextView.session_id) return false

      const current = store.get(difyBuilderSessionViewAtom)
      if (
        current &&
        current.session_id === nextView.session_id &&
        nextView.version < current.version
      )
        return false

      // Full server snapshots (GET, SSE snapshot, and SSE state) replace the
      // disposable in-memory projection atomically.
      setView(nextView)
      if (isTerminalView(nextView)) {
        setActiveSessionId((sessionId) => (sessionId === nextView.session_id ? null : sessionId))
      } else {
        setActiveSessionId(nextView.session_id)
      }
      return true
    },
    [setActiveSessionId, setView, store],
  )

  const applyCommit = useCallback(
    (commit: DifyBuilderCommitEventData) => {
      const activeSessionId = store.get(difyBuilderActiveSessionIdAtom)
      if (activeSessionId && activeSessionId !== commit.session_id) return

      setView((current) => {
        if (
          !current ||
          current.session_id !== commit.session_id ||
          commit.version <= current.version
        )
          return current
        return {
          ...current,
          version: commit.version,
          state: commit.state,
          canvas_read_only: true,
          run_status: 'executing',
          conversation: mergeConversation(current.conversation, commit.items),
        }
      })
    },
    [setView, store],
  )

  const applyAgentMessageDelta = useCallback(
    (message: AgentMessageEventData) => {
      const activeSessionId = store.get(difyBuilderActiveSessionIdAtom)
      if (activeSessionId && activeSessionId !== message.session_id) return

      setView((current) => {
        if (
          !current ||
          current.session_id !== message.session_id ||
          current.version >= message.at_version
        )
          return current

        const itemIndex = current.conversation.findIndex(
          (item) => item.kind === 'assistant_turn' && item.payload.turn_id === message.id,
        )
        if (itemIndex < 0) {
          const streamedItem: ConversationItem = {
            seq: message.seq,
            at_version: message.at_version,
            kind: 'assistant_turn',
            payload: {
              turn_id: message.id,
              stage_id: message.stage_id,
              trace: { status: 'running' },
              reply_text: message.answer,
            },
          }
          return {
            ...current,
            conversation: mergeConversation(current.conversation, [streamedItem]),
          }
        }

        const conversation = [...current.conversation]
        const currentItem = conversation[itemIndex]!
        if (currentItem.kind !== 'assistant_turn') return current
        conversation[itemIndex] = {
          ...currentItem,
          payload: {
            ...currentItem.payload,
            trace: { ...currentItem.payload.trace, status: 'running' },
            reply_text: `${currentItem.payload.reply_text ?? ''}${message.answer}`,
          },
        }
        return { ...current, conversation }
      })
    },
    [setView, store],
  )

  const clearSession = useCallback(
    (sessionId: string) => {
      setActiveSessionId((current) => (current === sessionId ? null : current))
      setView((current) => (current?.session_id === sessionId ? null : current))
    },
    [setActiveSessionId, setView],
  )

  const consumeStream = useCallback(
    async (
      events: AsyncIterable<DifyBuilderStreamEventResponse>,
      controller: AbortController,
      initialSessionId?: string,
      stopWhenNotExecuting = false,
    ): Promise<StreamOutcome> => {
      const outcome: StreamOutcome = {
        sessionId: initialSessionId,
        sawSnapshot: false,
        terminalEvent: null,
      }
      const handleEvent = (event: DifyBuilderStreamEventResponse): boolean => {
        setLastRaw(event.data)
        pushProgress(event.event, event.data)
        if (event.event === 'snapshot') {
          outcome.sawSnapshot = true
          outcome.sessionId = event.data.session_id
          applySessionView(event.data)
          if (stopWhenNotExecuting && event.data.run_status !== 'executing') {
            outcome.terminalEvent = 'state'
            outcome.stateApplied = true
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
          applyAgentMessageDelta(event.data)
          return false
        }

        if (event.event === 'state') {
          outcome.terminalEvent = 'state'
          outcome.sessionId = event.data.session_id
          const { kind: _kind, ...stateView } = event.data
          applySessionView(stateView)
          outcome.stateApplied = true
          return true
        }

        if (event.event === 'error') {
          outcome.terminalEvent = 'error'
          outcome.terminalError = streamErrorMessage(event.data)
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
    [
      applyAgentMessageDelta,
      applyCommit,
      applySessionView,
      pushProgress,
      setLastCanvasEvent,
      setLastError,
      setLastRaw,
    ],
  )

  const reconcileSession = useCallback(
    async (sessionId: string, controller: AbortController) => {
      try {
        const events = await consoleClient.difyBuilder.sessions.bySessionId.get(
          { params: { session_id: sessionId } },
          { context: { silent: true }, signal: controller.signal },
        )
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
    }: CommandOptions) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setIsBusy(true)
      setLastError('')
      if (startsSession) {
        setActiveSessionId(null)
        setProgressLog([])
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
          setLastError(outcome.transportError)
          pushProgress('error', outcome.transportError)
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
          setLastError(UNEXPECTED_EOF_ERROR)
          pushProgress('error', UNEXPECTED_EOF_ERROR)
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
        const message = requestErrorMessage(error)
        setLastError(message)
        pushProgress('error', message)
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
      pushProgress,
      reconcileSession,
      setActiveSessionId,
      setIsBusy,
      setLastCanvasEvent,
      setLastError,
      setProgressLog,
    ],
  )

  const startFix = useCallback(
    (appId: string, failedRunId: string, modelConfig?: SessionModel) =>
      runCommand({
        startsSession: true,
        expectTerminalEvent: true,
        openStream: (signal) =>
          consoleClient.difyBuilder.sessions.post(
            {
              body: {
                app_id: appId,
                scenario: 'fix',
                failed_run_id: failedRunId,
                ...(modelConfig ? { model_config: modelConfig } : {}),
              },
            },
            { signal },
          ),
      }),
    [runCommand],
  )

  const startChecklistFix = useCallback(
    (appId: string, checklistErrors: ChecklistErrorPayload[], modelConfig?: SessionModel) =>
      runCommand({
        startsSession: true,
        expectTerminalEvent: true,
        openStream: (signal) =>
          consoleClient.difyBuilder.sessions.post(
            {
              body: {
                app_id: appId,
                scenario: 'fix',
                checklist_errors: checklistErrors,
                ...(modelConfig ? { model_config: modelConfig } : {}),
              },
            },
            { signal },
          ),
      }),
    [runCommand],
  )

  const startBuild = useCallback(
    (appId: string, goalText: string, modelConfig?: SessionModel) =>
      runCommand({
        startsSession: true,
        expectTerminalEvent: true,
        openStream: (signal) =>
          consoleClient.difyBuilder.sessions.post(
            {
              body: {
                app_id: appId,
                scenario: 'build',
                goal_text: goalText,
                ...(modelConfig ? { model_config: modelConfig } : {}),
              },
            },
            { signal },
          ),
      }),
    [runCommand],
  )

  const startEdit = useCallback(
    (appId: string, goalText: string, modelConfig?: SessionModel) =>
      runCommand({
        startsSession: true,
        expectTerminalEvent: true,
        openStream: (signal) =>
          consoleClient.difyBuilder.sessions.post(
            {
              body: {
                app_id: appId,
                scenario: 'edit',
                goal_text: goalText,
                ...(modelConfig ? { model_config: modelConfig } : {}),
              },
            },
            { signal },
          ),
      }),
    [runCommand],
  )

  const restore = useCallback(
    async (sessionId: string) => {
      const normalizedSessionId = sessionId.trim()
      if (!normalizedSessionId || store.get(difyBuilderSessionBusyAtom)) return false

      const controller = new AbortController()
      abortRef.current = controller
      setActiveSessionId(normalizedSessionId)
      setIsBusy(true)
      setLastError('')
      try {
        const events = await consoleClient.difyBuilder.sessions.bySessionId.get(
          { params: { session_id: normalizedSessionId } },
          { context: { silent: true }, signal: controller.signal },
        )
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
        if (outcome.transportError) pushProgress('error', outcome.transportError)
        return false
      } catch (error) {
        if (!controller.signal.aborted) {
          const message = requestErrorMessage(error)
          if ([403, 404, 410].includes(requestErrorStatus(error) ?? 0))
            clearSession(normalizedSessionId)
          setLastError(message)
          pushProgress('error', message)
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
      pushProgress,
      reconcileSession,
      setActiveSessionId,
      setIsBusy,
      setLastError,
      store,
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
          consoleClient.difyBuilder.sessions.bySessionId.actions.post(
            {
              params: { session_id: view.session_id },
              body: {
                action_id: actionId,
                payload,
                base_version: view.version,
                base_app_revision: view.app_revision?.current ?? '',
              },
            },
            { signal },
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
          consoleClient.difyBuilder.sessions.bySessionId.messages.post(
            {
              params: { session_id: view.session_id },
              body: {
                text: normalizedText,
                base_version: view.version,
                client_turn_id: clientTurnId,
              },
            },
            { signal },
          ),
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
    pendingMessageRef.current = null
    setActiveSessionId(null)
    setView(null)
    setLastRaw(null)
    setLastError('')
    setProgressLog([])
    setLastCanvasEvent(null)
    setIsBusy(false)
  }, [
    setActiveSessionId,
    setIsBusy,
    setLastCanvasEvent,
    setLastError,
    setLastRaw,
    setProgressLog,
    setView,
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

export function useDifyBuilderSession(): UseDifyBuilderSessionResult {
  const controller = useDifyBuilderSessionController()
  const view = useAtomValue(difyBuilderSessionViewAtom)
  const isBusy = useAtomValue(difyBuilderSessionBusyAtom)
  const lastRaw = useAtomValue(difyBuilderSessionLastRawAtom)
  const lastError = useAtomValue(difyBuilderSessionLastErrorAtom)
  const progressLog = useAtomValue(difyBuilderSessionProgressLogAtom)

  return useMemo(
    () => ({
      view,
      isBusy,
      lastRaw,
      lastError,
      progressLog,
      ...controller,
    }),
    [controller, isBusy, lastError, lastRaw, progressLog, view],
  )
}
