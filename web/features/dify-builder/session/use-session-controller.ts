'use client'

import type {
  DifyBuilderAttachmentPayload,
  DifyBuilderReceiptSnapshot,
  DifyBuilderStreamEventResponse,
} from '@dify/contracts/api/console/dify-builder/types.gen'
import type {
  CanvasEventData,
  ChecklistErrorPayload,
  ConversationItem,
  DifyBuilderSessionController,
  SessionModel,
  SessionView,
} from '../types'
import type { PendingTaskControl } from './controller-types'
import type {
  PendingRetest,
  SessionCommandOptions,
  SessionRunEvents,
  SessionStreamOutcome,
} from './types'
import { isEqual } from 'es-toolkit/predicate'
import { useSetAtom, useStore } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import { useCallback, useEffect, useEffectEvent, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { consoleQuery } from '@/service/console'
import {
  difyBuilderCanvasAppliedViewAtom,
  difyBuilderCanvasReadyAtom,
  difyBuilderDraftAtom,
  difyBuilderLocalInteractionResponseAtom,
} from '../state'
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
  requestErrorCode,
  requestErrorMessage,
  requestErrorStatus,
  streamErrorMessage,
  UNEXPECTED_EOF_ERROR,
} from './errors'
import { hasConversationRange, mergeConversationPage, projectSessionView } from './projection'
import {
  difyBuilderActiveCommandAtom,
  difyBuilderActiveSessionIdAtom,
  difyBuilderConversationAtom,
  difyBuilderConversationHasMoreAtom,
  difyBuilderConversationLoadingAtom,
  difyBuilderLifecycleControlAtom,
  difyBuilderLocalUserMessageAtom,
  difyBuilderMaterialControlAtom,
  difyBuilderRetryableMessageAtom,
  difyBuilderSessionBusyAtom,
  difyBuilderSessionErrorCodeAtom,
  difyBuilderSessionLastErrorAtom,
  difyBuilderSessionViewAtom,
  difyBuilderTaskControlAtom,
} from './state'
import { createTraceBuffer, readTraceVersion } from './trace-buffer'
import { useDifyBuilderExecutionProgress } from './use-execution-progress'
import { useDifyBuilderFixControl } from './use-fix-control'
import { useDifyBuilderLifecycleControl } from './use-lifecycle-control'
import { useDifyBuilderLifecycleRecovery } from './use-lifecycle-recovery'
import { useDifyBuilderMaterialControl } from './use-material-control'
import { useDifyBuilderReasoningBuffer } from './use-reasoning-buffer'
import { useDifyBuilderSessionHistory } from './use-session-history'
import { useDifyBuilderSessionStream } from './use-session-stream'
import { useDifyBuilderStreamingTurnBuffer } from './use-streaming-turn-buffer'
import { useDifyBuilderTaskControl } from './use-task-control'

const commandWaitSignal = (signal: AbortSignal) =>
  AbortSignal.any([signal, AbortSignal.timeout(12 * 60 * 1000)])

const sessionOutcome = (view: SessionView, stateApplied: boolean): SessionStreamOutcome => ({
  terminalEvent: 'command_finished',
  finishedCommandId: view.last_command_id,
  terminalRunStatus: view.run_status,
  terminalInterrupted: view.interrupted,
  stateApplied,
})

const COMMAND_FINISHED_UNAVAILABLE_CODE = 'command_finished_unavailable'
const CONVERSATION_CLEARED = Symbol('conversation cleared')

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

export function useDifyBuilderSessionController(
  prepareCommand?: (saveDraft: boolean, signal: AbortSignal) => Promise<void>,
  runEvents?: SessionRunEvents,
  enabled = true,
): DifyBuilderSessionController {
  const store = useStore()

  const { t } = useTranslation(['difyBuilder'])

  const onSessionStateChanged = runEvents?.onSessionStateChanged

  const onAttachmentsAccepted = runEvents?.onAttachmentsAccepted

  const clearAttachmentDraft = runEvents?.clearAttachmentDraft

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

  const setTaskControl = useSetAtom(difyBuilderTaskControlAtom)

  const executionProgress = useDifyBuilderExecutionProgress()

  const reasoningBuffer = useDifyBuilderReasoningBuffer()

  const streamingTurnBuffer = useDifyBuilderStreamingTurnBuffer()

  const abortRef = useRef<AbortController | null>(null)

  const lifecycleAbortRef = useRef<AbortController | null>(null)

  const materialAbortRef = useRef<AbortController | null>(null)

  const pendingTaskControlRef = useRef<PendingTaskControl | null>(null)

  const canvasCursorRef = useRef<
    Pick<CanvasEventData, 'at_version' | 'operation_id' | 'revision' | 'session_id'> | undefined
  >(undefined)

  const nativeObservationRef = useRef(0)

  const pendingActionRef = useRef<{ signature: string; id: string } | null>(null)

  const pendingMessageRef = useRef<{ sessionId: string; text: string; turnId: string } | null>(null)

  const pendingRetestRef = useRef<PendingRetest | null>(null)

  const traceRef = useRef(createTraceBuffer())

  const resetDetachedRun = useEffectEvent(() => runEvents?.reset())

  useEffect(() => {
    if (!enabled) return
    return () => {
      abortRef.current?.abort()
      abortRef.current = null
      lifecycleAbortRef.current?.abort()
      lifecycleAbortRef.current = null
      materialAbortRef.current?.abort()
      materialAbortRef.current = null
      pendingRetestRef.current = null
      pendingTaskControlRef.current = null
      // Clearing the request ref prevents its finally block from releasing loading state.
      setIsBusy(false)
      setTaskControl(null)
      setConversationLoading(false)
      store.set(difyBuilderLifecycleControlAtom, (current) =>
        current?.phase === 'pending' ? { ...current, phase: 'unknown' } : current,
      )
      store.set(difyBuilderMaterialControlAtom, (current) =>
        current?.phase === 'pending' ? { ...current, phase: 'unknown' } : current,
      )
      resetDetachedRun()
    }
  }, [enabled, setConversationLoading, setIsBusy, setTaskControl, store])

  const {
    confirmLocalUserMessage,
    syncConversation,
    syncConversationRange,
    loadOlderConversation,
  } = useDifyBuilderSessionHistory({ abortRef, runEvents })

  const clearSession = useCallback(
    (sessionId: string) => {
      materialAbortRef.current?.abort()
      materialAbortRef.current = null
      setActiveSessionId((current) => (current === sessionId ? null : current))
      setActiveCommand((current) => (current?.session_id === sessionId ? null : current))
      setView((current) => (current?.session_id === sessionId ? null : current))
      setConversation([])
      setConversationHasMore(false)
      setLocalUserMessage(null)
      setRetryableMessage(null)
      store.set(difyBuilderMaterialControlAtom, null)
      clearAttachmentDraft?.()
      executionProgress.clear()
      reasoningBuffer.clear()
      streamingTurnBuffer.clear()
      runEvents?.reset()
    },
    [
      clearAttachmentDraft,
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
      store,
      streamingTurnBuffer,
    ],
  )

  const isolateClearedConversation = useCallback(
    (reading?: AbortController) => {
      materialAbortRef.current?.abort()
      materialAbortRef.current = null
      if (abortRef.current !== reading) {
        abortRef.current?.abort(CONVERSATION_CLEARED)
        abortRef.current = null
        setIsBusy(false)
      }
      setActiveCommand(null)
      pendingMessageRef.current = null
      pendingRetestRef.current = null
      setConversation([])
      setConversationHasMore(false)
      setLocalUserMessage(null)
      setRetryableMessage(null)
      store.set(difyBuilderMaterialControlAtom, null)
      clearAttachmentDraft?.()
      store.set(difyBuilderDraftAtom, '')
      store.set(difyBuilderLocalInteractionResponseAtom, null)
      setView((current) =>
        current
          ? {
              ...current,
              conversation_cleared: true,
              conversation_last_seq: -1,
              actions: [],
              decision: null,
              active_interaction: null,
              task_summaries: [],
              test_execution: undefined,
            }
          : null,
      )
      executionProgress.clear()
      reasoningBuffer.clear()
      streamingTurnBuffer.clear()
      runEvents?.reset()
    },
    [
      clearAttachmentDraft,
      executionProgress,
      reasoningBuffer,
      runEvents,
      setActiveCommand,
      setConversation,
      setConversationHasMore,
      setIsBusy,
      setLocalUserMessage,
      setRetryableMessage,
      setView,
      store,
      streamingTurnBuffer,
    ],
  )

  const projectLifecycleSettlement = useCallback(
    (view: SessionView, reading?: AbortController) => {
      const control = store.get(difyBuilderLifecycleControlAtom)
      const matches =
        control?.sessionId === view.session_id && control.clientActionId === view.last_command_id
      if (view.conversation_cleared) {
        isolateClearedConversation(reading)
        if (
          view.lifecycle_settlement === 'settled' &&
          (!control || (matches && control.operation === 'clear'))
        ) {
          store.set(difyBuilderLifecycleControlAtom, null)
          clearSession(view.session_id)
          setLastError('')
        } else {
          store.set(
            difyBuilderLifecycleControlAtom,
            control
              ? { ...control, phase: 'unknown' }
              : {
                  operation: 'clear',
                  phase: 'unknown',
                  sessionId: view.session_id,
                  clientActionId: view.last_command_id ?? '',
                  baseVersion: view.version,
                },
          )
          setLastError(t(($) => $['taskControl.unknown']))
        }
        return true
      }
      if (
        matches &&
        control?.operation === 'abandon' &&
        (!control.expectedTaskId || view.task_id === control.expectedTaskId) &&
        view.lifecycle_settlement === 'settled'
      ) {
        store.set(difyBuilderLifecycleControlAtom, null)
        setLastError('')
      }
      return false
    },
    [clearSession, isolateClearedConversation, setLastError, store, t],
  )

  const applySessionView = useCallback(
    (
      nextView: SessionView,
      observedAtStart: number | 'stream' = nativeObservationRef.current,
      reading?: AbortController,
    ) => {
      const activeSessionId = store.get(difyBuilderActiveSessionIdAtom)
      if (activeSessionId && activeSessionId !== nextView.session_id) return false

      const current = store.get(difyBuilderSessionViewAtom)
      // Clearing is irreversible within this session, including against an
      // older response that was already in flight when Clear was acknowledged.
      if (
        current?.session_id === nextView.session_id &&
        current.conversation_cleared &&
        !nextView.conversation_cleared
      )
        return false
      // A delayed acknowledgment or terminal event can carry an older Native
      // Test receipt even when its native counters are equal to the live view.
      const preserveObservedReceipt =
        observedAtStart !== 'stream' &&
        observedAtStart < nativeObservationRef.current &&
        sameNativeReceiptOrder(current?.test_execution, nextView.test_execution)
      const preserveReceipt =
        current?.session_id === nextView.session_id &&
        ((nextView.test_execution === undefined && current.test_execution !== undefined) ||
          olderNativeReceipt(current.test_execution, nextView.test_execution) ||
          preserveObservedReceipt)
      const incoming = preserveReceipt
        ? { ...nextView, test_execution: current.test_execution }
        : nextView
      const projected = projectSessionView(current, incoming)
      if (!projected) return false
      if (current && isEqual(current, projected)) return true

      // Bounded JSON/SSE session projections replace metadata atomically;
      // durable conversation rows have their own paginated owner.
      if (observedAtStart === 'stream' && !preserveReceipt) nativeObservationRef.current += 1
      setView(projected)
      const material = store.get(difyBuilderMaterialControlAtom)
      if (
        material?.phase === 'unknown' &&
        projected.attachments?.some((receipt) => receipt.client_turn_id === material.clientTurnId)
      ) {
        store.set(difyBuilderMaterialControlAtom, null)
        onAttachmentsAccepted?.(material.attachments, material.text)
      }
      if (projectLifecycleSettlement(projected, reading)) return true
      onSessionStateChanged?.(projected)
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
    [
      onAttachmentsAccepted,
      onSessionStateChanged,
      projectLifecycleSettlement,
      setActiveSessionId,
      setView,
      store,
    ],
  )

  const hydrateSessionView = useCallback(
    async (
      view: SessionView,
      controller: AbortController,
      observedAtStart: number | 'stream',
      restoreRun = false,
    ) => {
      if (
        controller.signal.aborted ||
        store.get(difyBuilderActiveSessionIdAtom) !== view.session_id
      )
        return
      const stateApplied = applySessionView(view, observedAtStart, controller)
      const projected = store.get(difyBuilderSessionViewAtom)
      if (stateApplied && view.conversation_cleared)
        return { view, historyApplied: true, stateApplied }
      if (projected?.session_id !== view.session_id) return
      if (projected.conversation_cleared)
        return { view: projected, historyApplied: true, stateApplied }
      const items = store.get(difyBuilderConversationAtom)
      const throughSequence = projected.conversation_last_seq
      const afterSequence = (items[0]?.seq ?? 0) - 1
      const covered = hasConversationRange(items, afterSequence, throughSequence)
      if (restoreRun && covered && items.length) runEvents?.restoreRun(view.session_id, items)
      const historyApplied =
        covered ||
        (items.length
          ? await syncConversationRange(view.session_id, afterSequence, throughSequence, controller)
          : await syncConversation(view.session_id, throughSequence, controller))
      if (controller.signal.aborted) return
      const latest = store.get(difyBuilderSessionViewAtom)
      if (latest?.session_id !== view.session_id) return
      return { view: latest, historyApplied, stateApplied }
    },
    [applySessionView, runEvents, store, syncConversation, syncConversationRange],
  )

  const projectStreamEvent = useCallback(
    async (event: DifyBuilderStreamEventResponse, controller: AbortController) => {
      const current = store.get(difyBuilderSessionViewAtom)
      if (
        current?.conversation_cleared &&
        event.event !== 'session_ready' &&
        event.event !== 'session_state'
      )
        return

      traceRef.current.append({
        dir: 'in',
        kind: event.event,
        payload: event.data,
        version: readTraceVersion(event.data),
      })

      if (event.event === 'session_ready' || event.event === 'session_state') {
        const hydrated = await hydrateSessionView(
          event.data,
          controller,
          'stream',
          event.event === 'session_ready',
        )
        if (!hydrated) return
        const { view, historyApplied } = hydrated
        if (!historyApplied) throw new Error(UNEXPECTED_EOF_ERROR)
        if (view.command_pending && !view.conversation_cleared) {
          setActiveCommand((command) =>
            command?.session_id === view.session_id
              ? command
              : {
                  session_id: view.session_id,
                  version: view.version,
                  phase: view.phase,
                  run_status: 'processing',
                },
          )
        } else {
          setActiveCommand((command) =>
            command?.session_id === view.session_id &&
            (!command.command_id ||
              command.command_id === view.last_command_id ||
              command.version < view.version)
              ? null
              : command,
          )
        }
        return { view }
      }

      if (event.event === 'command_started') {
        const active = store.get(difyBuilderActiveCommandAtom)
        if (
          current &&
          (current.version > event.data.version ||
            (!current.command_pending && current.last_command_id === event.data.command_id))
        )
          return
        if (active?.command_id !== event.data.command_id) {
          executionProgress.clear()
          reasoningBuffer.clear()
          streamingTurnBuffer.clear()
        }
        setActiveCommand(event.data)
        runEvents?.onSessionStateChanged?.(event.data)
        return { started: true as const }
      }

      if (event.event === 'canvas' || event.event === 'workflow') {
        const activeCommand = store.get(difyBuilderActiveCommandAtom)
        const cursor = canvasCursorRef.current
        if (
          (current?.session_id === event.data.session_id &&
            current.version >= event.data.at_version) ||
          (activeCommand?.session_id === event.data.session_id &&
            activeCommand.version >= event.data.at_version) ||
          (cursor?.session_id === event.data.session_id &&
            (cursor.at_version > event.data.at_version ||
              (cursor.at_version === event.data.at_version &&
                cursor.operation_id === event.data.operation_id &&
                cursor.revision >= event.data.revision)))
        )
          return
        canvasCursorRef.current = event.data
        if (event.event === 'canvas') runEvents?.onCanvasEvent(event.data)
        else runEvents?.onWorkflowEvent(event.data)
        return
      }

      if (event.event === 'reasoning') {
        reasoningBuffer.enqueue(event.data)
        return
      }

      if (event.event === 'progress' || event.event === 'progress_snapshot') {
        executionProgress.enqueue(event.data)
        return
      }

      if (event.event === 'conversation_item_appended') {
        const item = event.data.item
        setConversation((items) =>
          mergeConversationPage(items, [
            item.kind === 'assistant_turn' && !items.some((candidate) => candidate.seq === item.seq)
              ? { ...item, receivedAt: Date.now() }
              : item,
          ]),
        )
        if (item.kind === 'assistant_turn') {
          executionProgress.clearThroughVersion(event.data.session_id, item.at_version)
          reasoningBuffer.clearThroughVersion(event.data.session_id, item.at_version)
        }
        confirmLocalUserMessage(event.data.session_id, [item])
        return
      }

      if (event.event === 'agent_message') {
        if (store.get(difyBuilderConversationAtom).some((item) => item.seq === event.data.seq))
          return
        if (!event.data.done) {
          streamingTurnBuffer.enqueue(event.data)
          return
        }

        const streamedTurn = await streamingTurnBuffer.finish(event.data)
        if (controller.signal.aborted || !streamedTurn) return
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
        setConversation((items) => mergeConversationPage(items, [assistantItem]))
        executionProgress.clearThroughVersion(event.data.session_id, event.data.at_version)
        return
      }

      if (event.event === 'command_finished') {
        const { command_id, post_canvas_action_id, ...state } = event.data
        const view = { ...state, last_command_id: command_id }
        const active = store.get(difyBuilderActiveCommandAtom)
        if (
          active?.session_id === view.session_id &&
          active.version <= view.version &&
          (!active.command_id || active.command_id === command_id)
        ) {
          setActiveCommand(null)
          executionProgress.clear()
          reasoningBuffer.clear()
          streamingTurnBuffer.clear()
        }
        const hydrated = await hydrateSessionView(view, controller, 0)
        if (!hydrated) return
        const outcome = sessionOutcome(view, hydrated.stateApplied && hydrated.historyApplied)
        if (
          post_canvas_action_id &&
          view.app_revision &&
          hydrated.view.version === view.version &&
          hydrated.view.last_command_id === command_id
        ) {
          outcome.retest = {
            sessionId: view.session_id,
            version: view.version,
            appRevision: view.app_revision.current,
            actionId: post_canvas_action_id,
          }
        }
        return { view: hydrated.view, outcome }
      }

      if (event.event === 'error') {
        const commandId = event.data.command_id
        if (store.get(difyBuilderActiveCommandAtom)?.command_id === commandId) {
          setActiveCommand(null)
          executionProgress.clear()
          reasoningBuffer.clear()
          streamingTurnBuffer.clear()
        }
        if (event.data.code === COMMAND_FINISHED_UNAVAILABLE_CODE) runEvents?.onStreamInterrupted()
        return {
          outcome: {
            terminalEvent: 'error' as const,
            terminalError: streamErrorMessage(event.data),
            terminalErrorCode: event.data.code ?? undefined,
            finishedCommandId: commandId ?? undefined,
            stateApplied: false,
          },
        }
      }
    },
    [
      confirmLocalUserMessage,
      executionProgress,
      hydrateSessionView,
      reasoningBuffer,
      runEvents,
      setActiveCommand,
      setConversation,
      store,
      streamingTurnBuffer,
    ],
  )

  const waitForSession = useDifyBuilderSessionStream({
    enabled,
    onEvent: projectStreamEvent,
    onDisconnect: () => {
      if (store.get(difyBuilderActiveCommandAtom)) runEvents?.onStreamInterrupted()
    },
  })

  const { readFixControl, lifecycleError } = useDifyBuilderLifecycleRecovery({
    t,
    lifecycleAbortRef,
  })

  const reconcileSession = useCallback(
    async (sessionId: string, controller: AbortController, refresh = false) => {
      const observation = await waitForSession(sessionId, controller.signal)
      const priorOutcome = observation.latestOutcome
      let view = store.get(difyBuilderSessionViewAtom)
      if (refresh) {
        const observedAtStart = nativeObservationRef.current
        const snapshot = await getSession(sessionId, controller.signal)
        traceRef.current.append({
          dir: 'in',
          kind: 'session_snapshot',
          payload: snapshot,
          version: snapshot.version,
        })
        const hydrated = await hydrateSessionView(snapshot, controller, observedAtStart)
        if (!hydrated?.historyApplied) return
        view = hydrated.view
      }
      controller.signal.throwIfAborted()
      if (!view || view.session_id !== sessionId) return
      if (view.conversation_cleared) return sessionOutcome(view, true)
      await readFixControl(sessionId, controller)
      if (!view.command_pending) return sessionOutcome(view, true)
      return observation.waitFor((current) => {
        if (current.latestOutcome && current.latestOutcome !== priorOutcome)
          return current.latestOutcome
        if (current.view && !current.view.command_pending) return sessionOutcome(current.view, true)
      }, commandWaitSignal(controller.signal))
    },
    [hydrateSessionView, readFixControl, store, waitForSession],
  )

  const runCommand = useCallback(
    async (
      options: SessionCommandOptions & {
        prepareDispatch?: (signal: AbortSignal) => Promise<SessionCommandOptions['trace']>
      },
    ) => {
      if (!enabled || store.get(difyBuilderLifecycleControlAtom)) return false
      const {
        create,
        initialAttachments,
        prepareDraft = true,
        prepareDispatch,
        submit,
        trace,
      } = options
      let sessionId = options.knownSessionId
      abortRef.current?.abort()
      pendingRetestRef.current = null
      executionProgress.clear()
      reasoningBuffer.clear()
      streamingTurnBuffer.clear()
      const controller = new AbortController()
      const { signal } = controller
      abortRef.current = controller
      const preparation = prepareDraft ? prepareCommand?.(true, signal) : undefined
      setIsBusy(true)
      runEvents?.onCommandStarted?.()
      setLastError('')
      store.set(difyBuilderSessionErrorCodeAtom, null)
      let submitted = false

      try {
        await preparation
        signal.throwIfAborted()
        if (create) {
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
          traceRef.current.clear()
          if (trace)
            traceRef.current.append({ dir: 'out', kind: trace.kind, payload: trace.payload })
        }

        const created = create ? await create(signal) : undefined
        signal.throwIfAborted()
        if (created) {
          sessionId = created.session.session_id
          setActiveSessionId(sessionId)
          setLocalUserMessage((current) =>
            current?.sessionId === null
              ? { ...current, sessionId: created.session.session_id }
              : current,
          )
          if (initialAttachments?.length) onAttachmentsAccepted?.(initialAttachments)
        }
        if (!sessionId) return false
        const dispatchTrace = prepareDispatch ? await prepareDispatch(signal) : trace
        signal.throwIfAborted()
        const observation = await waitForSession(sessionId, signal)
        if (created && !created.requires_start)
          return options.prepareExisting ? await options.prepareExisting() : true
        if (!create && dispatchTrace)
          traceRef.current.append({
            dir: 'out',
            kind: dispatchTrace.kind,
            payload: dispatchTrace.payload,
          })

        const startingVersion = store.get(difyBuilderSessionViewAtom)?.version ?? 0
        const observedAtStart = nativeObservationRef.current
        submitted = true
        const receipt = created
          ? await runSessionAction(
              sessionId,
              'start_session',
              {},
              created.session.version,
              created.session.app_revision?.current ?? '',
              signal,
            )
          : await submit?.(signal)
        signal.throwIfAborted()
        if (!receipt) return false
        traceRef.current.append({ dir: 'in', kind: 'command_ack', payload: receipt })

        if (receipt.session) {
          const hydrated = await hydrateSessionView(receipt.session, controller, observedAtStart)
          if (!receipt.pending) return hydrated?.historyApplied === true
        }
        if (!receipt.pending) throw new Error(UNEXPECTED_EOF_ERROR)

        const commandId = receipt.command_id
        const view = store.get(difyBuilderSessionViewAtom)
        if (
          view?.session_id === sessionId &&
          !observation.outcomes.has(commandId) &&
          !(
            view.last_command_id === commandId &&
            !view.command_pending &&
            view.version > startingVersion
          )
        ) {
          setActiveCommand((active) =>
            active?.command_id === commandId
              ? active
              : {
                  session_id: view.session_id,
                  command_id: commandId,
                  version: view.version,
                  phase: view.phase,
                  run_status: 'processing',
                },
          )
        }
        const outcome = await observation.waitFor((current) => {
          const terminal = current.outcomes.get(commandId)
          if (terminal) return terminal
          const latest = current.view
          if (
            latest &&
            latest.last_command_id === commandId &&
            !latest.command_pending &&
            latest.version > startingVersion
          )
            return sessionOutcome(latest, true)
        }, commandWaitSignal(signal))
        if (outcome.terminalEvent === 'error' || !outcome.stateApplied) {
          const reconciled = await reconcileSession(sessionId, controller, true)
          if (
            outcome.terminalErrorCode === COMMAND_FINISHED_UNAVAILABLE_CODE &&
            reconciled?.finishedCommandId === commandId &&
            reconciled.stateApplied &&
            (store.get(difyBuilderSessionViewAtom)?.version ?? 0) > startingVersion &&
            reconciled.terminalRunStatus !== 'failed' &&
            !reconciled.terminalInterrupted
          )
            return true
          setLastError(outcome.terminalError || UNEXPECTED_EOF_ERROR)
          return false
        }
        const succeeded = outcome.terminalRunStatus !== 'failed' && !outcome.terminalInterrupted
        if (succeeded && outcome.retest) pendingRetestRef.current = outcome.retest
        return succeeded
      } catch (error) {
        if (signal.aborted) return false
        const message = await requestErrorMessage(error)
        const code = await requestErrorCode(error)
        if (signal.aborted) return false
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
        if (submitted && sessionId && !signal.aborted) {
          const observedAtStart = nativeObservationRef.current
          try {
            const snapshot = await getSession(sessionId, signal)
            await hydrateSessionView(snapshot, controller, observedAtStart)
          } catch {
            // Report the admission failure while observation continues.
          }
        }
        if (!signal.aborted) setLastError(message)
        return false
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null
          setIsBusy(false)
          runEvents?.finishCommand()
        }
      }
    },
    [
      enabled,
      executionProgress,
      hydrateSessionView,
      onAttachmentsAccepted,
      prepareCommand,
      reasoningBuffer,
      reconcileSession,
      runEvents,
      setActiveCommand,
      setActiveSessionId,
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
      waitForSession,
    ],
  )

  const { prepareExistingFix, submitFixDecision } = useDifyBuilderFixControl({
    t,
    abortRef,
    lifecycleAbortRef,
    traceRef,
    applySessionView,
    nativeObservationRef,
    waitForSession,
    reconcileSession,
    lifecycleError,
    runEvents,
  })

  const startFix = useCallback(
    (appId: string, failedRunId: string, modelConfig?: SessionModel) => {
      const prepareExisting = () =>
        prepareExistingFix({
          failed_run_id: failedRunId,
          ...(modelConfig ? { model_config: modelConfig } : {}),
        })
      return store.get(difyBuilderActiveSessionIdAtom) || store.get(difyBuilderSessionViewAtom)
        ? prepareExisting()
        : runCommand({
            create: (signal) => createFixSession(appId, failedRunId, modelConfig, signal),
            prepareExisting,
            trace: {
              kind: 'session_start',
              payload: { scenario: 'fix', app_id: appId, failed_run_id: failedRunId },
            },
          })
    },
    [prepareExistingFix, runCommand, store],
  )

  const startChecklistFix = useCallback(
    (appId: string, checklistErrors: ChecklistErrorPayload[], modelConfig?: SessionModel) => {
      const prepareExisting = () =>
        prepareExistingFix({
          checklist_errors: checklistErrors,
          ...(modelConfig ? { model_config: modelConfig } : {}),
        })
      return store.get(difyBuilderActiveSessionIdAtom) || store.get(difyBuilderSessionViewAtom)
        ? prepareExisting()
        : runCommand({
            create: (signal) =>
              createChecklistFixSession(appId, checklistErrors, modelConfig, signal),
            prepareExisting,
            trace: {
              kind: 'session_start',
              payload: { scenario: 'fix', app_id: appId, checklist_errors: checklistErrors },
            },
          })
    },
    [prepareExistingFix, runCommand, store],
  )

  const startBuild = useCallback(
    async (
      appId: string,
      goalText: string,
      modelConfig?: SessionModel,
      deriveAppName = false,
      attachments?: DifyBuilderAttachmentPayload[],
    ) => {
      const started = await runCommand({
        initialAttachments: attachments,
        create: (signal) =>
          createBuildSession(appId, goalText, modelConfig, signal, deriveAppName, attachments),
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
    (
      appId: string,
      goalText: string,
      modelConfig?: SessionModel,
      attachments?: DifyBuilderAttachmentPayload[],
    ) =>
      runCommand({
        initialAttachments: attachments,
        create: (signal) => createEditSession(appId, goalText, modelConfig, signal, attachments),
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
      runEvents?.onCommandStarted?.()
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
        const sameSession =
          store.get(difyBuilderSessionViewAtom)?.session_id === normalizedSessionId
        if (!sameSession) {
          setConversation([])
          runEvents?.reset()
        }
        // Explicit recovery always revalidates the canvas.
        store.set(difyBuilderCanvasAppliedViewAtom, null)
        const outcome = await reconcileSession(normalizedSessionId, controller, sameSession)
        if (controller.signal.aborted) return false
        if (outcome?.terminalEvent === 'command_finished') return outcome.stateApplied === true
        if (outcome?.terminalEvent === 'error') {
          setLastError(outcome.terminalError || 'Builder command failed.')
          return false
        }
        setLastError(UNEXPECTED_EOF_ERROR)
        return false
      } catch (error) {
        if (controller.signal.reason === CONVERSATION_CLEARED) return true
        if (!controller.signal.aborted) {
          if ([404, 410].includes(requestErrorStatus(error) ?? 0)) clearSession(normalizedSessionId)
          const message = await requestErrorMessage(error)
          if (controller.signal.aborted) return false
          setLastError(message)
        }
        return false
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null
          setIsBusy(false)
          runEvents?.finishCommand()
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

  const { stopTask, resumeTask } = useDifyBuilderTaskControl({
    t,
    executionProgress,
    reasoningBuffer,
    streamingTurnBuffer,
    abortRef,
    pendingTaskControlRef,
    nativeObservationRef,
    pendingActionRef,
    pendingMessageRef,
    pendingRetestRef,
    traceRef,
    syncConversation,
    applySessionView,
    reconcileSession,
    waitForSession,
    prepareCommand,
    runEvents,
  })

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
      submit: (signal) =>
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
      const selectedId = actionId === 'confirm' ? payload.option_id : actionId
      if (selectedId === 'dismiss_fix' || selectedId === 'stop_and_switch_fix')
        return submitFixDecision(actionId, payload, receiptSnapshot)
      if (
        !view ||
        store.get(difyBuilderSessionBusyAtom) ||
        store.get(difyBuilderLifecycleControlAtom) ||
        store.get(difyBuilderMaterialControlAtom)
      )
        return false
      const nativeControl =
        typeof selectedId === 'string' &&
        ['confirm_test_operation', 'deny_test_operation', 'resume_test', 'cancel_test'].includes(
          selectedId,
        )
      const selectedAction = view.actions?.find((action) => action.id === selectedId)
      const recoveryAction =
        typeof selectedId === 'string' &&
        ['check_recovery', 'recovery_continue', 'restart'].includes(selectedId)
      if ((nativeControl || recoveryAction) && !selectedAction) return false
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
      let requestView = view
      const actionTrace = () => ({
        kind: 'action',
        payload: {
          action_id: actionId,
          payload: actionPayload,
          base_version: requestView.version,
          base_app_revision: requestView.app_revision?.current ?? '',
          client_action_id: clientActionId,
        },
      })
      const succeeded = await runCommand({
        knownSessionId: view.session_id,
        // These control an already admitted immutable attempt; do not save or
        // rewrite the canvas while approving, cancelling or resuming it.
        prepareDraft: !nativeControl,
        prepareDispatch: recoveryAction
          ? async (signal) => {
              const ownsSession = () => {
                const activeSessionId = store.get(difyBuilderActiveSessionIdAtom)
                return (
                  (!activeSessionId || activeSessionId === view.session_id) &&
                  store.get(difyBuilderSessionViewAtom)?.session_id === view.session_id
                )
              }
              const sameSelection = (candidate: SessionView) => {
                const action = candidate.actions?.find((action) => action.id === selectedId)
                return (
                  Boolean(action) &&
                  isEqual(action, selectedAction) &&
                  // Autosave advances valid_at_version; action/card identify the interaction.
                  candidate.active_interaction?.action_id === view.active_interaction?.action_id &&
                  candidate.active_interaction?.card_seq === view.active_interaction?.card_seq
                )
              }
              signal.throwIfAborted()
              if (!ownsSession()) throw new Error(t(($) => $['taskControl.conflict']))
              const observedAtStart = nativeObservationRef.current
              const snapshot = await getSession(view.session_id, signal)
              signal.throwIfAborted()
              const current = store.get(difyBuilderSessionViewAtom)
              if (!ownsSession() || snapshot.session_id !== view.session_id || !current)
                throw new Error(t(($) => $['taskControl.conflict']))
              const selectionValid = sameSelection(current) && sameSelection(snapshot)
              traceRef.current.append({
                dir: 'in',
                kind: 'session_snapshot',
                payload: snapshot,
                version: snapshot.version,
              })
              if (!applySessionView(snapshot, observedAtStart) || !selectionValid)
                throw new Error(t(($) => $['taskControl.conflict']))
              // Keep the user's original payload. A replacement action/card
              // requires a new selection, even if it has the same action ID.
              requestView = snapshot
              return actionTrace()
            }
          : undefined,
        submit: (signal) =>
          runSessionAction(
            view.session_id,
            actionId,
            actionPayload,
            requestView.version,
            requestView.app_revision?.current ?? '',
            signal,
            receiptSnapshot,
            clientActionId,
          ),
        trace: actionTrace(),
      })
      // Also handles a refresh that completed before this command promise resumed.
      if (succeeded && pendingRetestRef.current) continueRetest()
      return succeeded
    },
    [applySessionView, continueRetest, runCommand, store, submitFixDecision, t],
  )

  const { sendMaterial } = useDifyBuilderMaterialControl({
    onAttachmentsAccepted,
    materialAbortRef,
    traceRef,
    applySessionView,
    waitForSession,
    nativeObservationRef,
  })

  const sendMessage = useCallback(
    async (
      text: string,
      requestedTurnId?: string,
      attachments?: DifyBuilderAttachmentPayload[],
    ) => {
      const view = store.get(difyBuilderSessionViewAtom)
      if (attachments?.length) return sendMaterial(text, attachments)
      if (
        !view ||
        store.get(difyBuilderSessionBusyAtom) ||
        store.get(difyBuilderLifecycleControlAtom) ||
        store.get(difyBuilderMaterialControlAtom)
      )
        return false
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
        submit: (signal) =>
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
    [runCommand, sendMaterial, setLocalUserMessage, setRetryableMessage, store],
  )

  const updateModel = useCallback(
    (modelConfig: SessionModel) => runAction('update_model', { model_config: modelConfig }),
    [runAction],
  )

  const reset = useCallback(() => {
    materialAbortRef.current?.abort()
    materialAbortRef.current = null
    store.set(difyBuilderMaterialControlAtom, null)
    clearAttachmentDraft?.()
    lifecycleAbortRef.current?.abort()
    lifecycleAbortRef.current = null
    store.set(difyBuilderLifecycleControlAtom, null)
    abortRef.current?.abort()
    abortRef.current = null
    pendingRetestRef.current = null
    pendingTaskControlRef.current = null
    setTaskControl(null)
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
    setIsBusy(false)
    runEvents?.reset()
    canvasCursorRef.current = undefined
    traceRef.current.clear()
  }, [
    clearAttachmentDraft,
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
    setTaskControl,
    store,
    streamingTurnBuffer,
  ])

  const { clearConversation, abandonTask } = useDifyBuilderLifecycleControl({
    t,
    abortRef,
    lifecycleAbortRef,
    traceRef,
    syncConversation,
    isolateClearedConversation,
    applySessionView,
    lifecycleError,
  })

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
      stopTask,
      resumeTask,
      runAction,
      sendMessage,
      updateModel,
      reset,
      clearConversation,
      abandonTask,
      getTrace,
      onCanvasRefreshed,
    }),
    [
      refresh,
      loadOlderConversation,
      reset,
      clearConversation,
      abandonTask,
      restore,
      stopTask,
      resumeTask,
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
