'use client'

import type {
  DifyBuilderFixIntentPayload,
  DifyBuilderReceiptSnapshot,
} from '@dify/contracts/api/console/dify-builder/types.gen'
import type { SessionView } from '../types'
import type { SessionControllerContext } from './controller-types'
import type { DifyBuilderLifecycleControl } from './state'
import { useSetAtom, useStore } from 'jotai'
import { useCallback } from 'react'
import { prepareSessionFix, runSessionAction } from './client'
import { streamErrorMessage, UNEXPECTED_EOF_ERROR } from './errors'
import { isActiveView } from './projection'
import {
  difyBuilderActiveCommandAtom,
  difyBuilderActiveSessionIdAtom,
  difyBuilderLifecycleControlAtom,
  difyBuilderSessionBusyAtom,
  difyBuilderSessionLastErrorAtom,
  difyBuilderSessionViewAtom,
  difyBuilderTaskControlAtom,
} from './state'

export function useDifyBuilderFixControl({
  t,
  abortRef,
  lifecycleAbortRef,
  traceRef,
  applySessionView,
  reconcileSession,
  lifecycleError,
  runEvents,
}: Pick<
  SessionControllerContext,
  | 't'
  | 'abortRef'
  | 'lifecycleAbortRef'
  | 'traceRef'
  | 'applySessionView'
  | 'reconcileSession'
  | 'lifecycleError'
  | 'runEvents'
>) {
  const store = useStore()

  const setActiveCommand = useSetAtom(difyBuilderActiveCommandAtom)

  const setLastError = useSetAtom(difyBuilderSessionLastErrorAtom)

  const setIsBusy = useSetAtom(difyBuilderSessionBusyAtom)

  const watchFix = useCallback(
    async (sessionId: string, controller: AbortController) => {
      if (abortRef.current) return true
      abortRef.current = controller
      setIsBusy(true)
      try {
        const outcome = await reconcileSession(sessionId, controller)
        return !controller.signal.aborted && outcome?.stateApplied === true
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null
          setIsBusy(false)
          runEvents?.finishCommand()
        }
      }
    },
    [reconcileSession, runEvents, setIsBusy, abortRef],
  )

  const prepareExistingFix = useCallback(
    async (
      source: Pick<
        DifyBuilderFixIntentPayload,
        'failed_run_id' | 'checklist_errors' | 'model_config'
      >,
    ) => {
      const view = store.get(difyBuilderSessionViewAtom)
      const command = store.get(difyBuilderActiveCommandAtom)
      const sessionId = view?.session_id ?? store.get(difyBuilderActiveSessionIdAtom)
      const version = view?.version ?? command?.version
      if (
        !sessionId ||
        !version ||
        store.get(difyBuilderLifecycleControlAtom) ||
        store.get(difyBuilderTaskControlAtom)
      )
        return false
      const controller = new AbortController()
      lifecycleAbortRef.current = controller
      setLastError('')
      const body: DifyBuilderFixIntentPayload = {
        ...source,
        base_version: version,
        client_action_id: globalThis.crypto.randomUUID(),
      }
      store.set(difyBuilderLifecycleControlAtom, {
        operation: 'fix',
        phase: 'pending',
        sessionId,
        clientActionId: body.client_action_id,
        baseVersion: body.base_version,
        ...(view?.task_id ? { expectedTaskId: view.task_id } : {}),
      })
      traceRef.current.append({ dir: 'out', kind: 'fix_intent', payload: body })
      try {
        const receipt = await prepareSessionFix(sessionId, body, controller.signal)
        if (
          controller.signal.aborted ||
          store.get(difyBuilderActiveSessionIdAtom) !== sessionId ||
          store.get(difyBuilderSessionViewAtom)?.conversation_cleared
        )
          return false
        traceRef.current.append({ dir: 'in', kind: 'fix_intent_ack', payload: receipt })
        applySessionView(receipt.session)
        store.set(difyBuilderLifecycleControlAtom, null)
        if (receipt.status === 'activated' && isActiveView(receipt.session))
          return await watchFix(sessionId, controller)
        return true
      } catch (error) {
        await lifecycleError('fix', error, controller)
        return false
      } finally {
        if (lifecycleAbortRef.current === controller) lifecycleAbortRef.current = null
      }
    },
    [applySessionView, lifecycleError, setLastError, store, watchFix, lifecycleAbortRef, traceRef],
  )

  const submitFixDecision = useCallback(
    async (
      actionId: string,
      payload: Record<string, unknown>,
      receiptSnapshot?: DifyBuilderReceiptSnapshot,
    ) => {
      const view = store.get(difyBuilderSessionViewAtom)
      const selected = actionId === 'confirm' ? payload.option_id : actionId
      if (
        !view?.pending_fix_context ||
        (selected !== 'dismiss_fix' && selected !== 'stop_and_switch_fix') ||
        store.get(difyBuilderLifecycleControlAtom) ||
        store.get(difyBuilderTaskControlAtom)
      )
        return false
      const action = view.actions?.find((candidate) => candidate.id === selected)
      if (
        !action ||
        typeof action.payload?.fix_intent_id !== 'string' ||
        typeof action.payload.expected_task_id !== 'string'
      )
        return false
      const controller = new AbortController()
      lifecycleAbortRef.current = controller
      setLastError('')
      const actionPayload = { ...action.payload, ...payload }
      const clientActionId = globalThis.crypto.randomUUID()
      const control: DifyBuilderLifecycleControl = {
        operation: selected,
        phase: 'pending',
        sessionId: view.session_id,
        clientActionId,
        baseVersion: view.version,
        expectedTaskId: action.payload.expected_task_id,
        fixIntentId: action.payload.fix_intent_id,
      }
      store.set(difyBuilderLifecycleControlAtom, control)
      traceRef.current.append({
        dir: 'out',
        kind: 'fix_decision',
        payload: {
          action_id: actionId,
          payload: actionPayload,
          base_version: view.version,
          client_action_id: clientActionId,
        },
      })
      try {
        const stream = await runSessionAction(
          view.session_id,
          actionId,
          actionPayload,
          view.version,
          view.app_revision?.current ?? '',
          controller.signal,
          receiptSnapshot,
          clientActionId,
        )
        let settled: SessionView | null = null
        for await (const event of stream) {
          if (
            controller.signal.aborted ||
            store.get(difyBuilderSessionViewAtom)?.session_id !== view.session_id
          )
            return false
          traceRef.current.append({ dir: 'in', kind: event.event, payload: event.data })
          if (event.event === 'error') throw new Error(streamErrorMessage(event.data))
          if (event.event === 'command_finished' && event.data.session_id === view.session_id) {
            settled = { ...event.data, last_command_id: event.data.command_id }
            applySessionView(settled)
            break
          }
        }
        if (!settled) throw new Error(UNEXPECTED_EOF_ERROR)
        if (selected === 'stop_and_switch_fix') {
          // Only an explicitly acknowledged switch retires the original response.
          abortRef.current?.abort()
          abortRef.current = null
          setIsBusy(false)
          setActiveCommand(null)
          if (settled.pending_fix_context) {
            store.set(difyBuilderLifecycleControlAtom, { ...control, phase: 'unknown' })
            setLastError(t(($) => $['taskControl.unknown']))
            return false
          }
        }
        store.set(difyBuilderLifecycleControlAtom, null)
        if (selected === 'stop_and_switch_fix' && isActiveView(settled))
          return await watchFix(view.session_id, controller)
        return true
      } catch (error) {
        await lifecycleError(selected, error, controller)
        return false
      } finally {
        if (lifecycleAbortRef.current === controller) lifecycleAbortRef.current = null
      }
    },
    [
      applySessionView,
      lifecycleError,
      setActiveCommand,
      setIsBusy,
      setLastError,
      store,
      t,
      watchFix,
      lifecycleAbortRef,
      traceRef,
      abortRef,
    ],
  )

  return { prepareExistingFix, submitFixDecision }
}
