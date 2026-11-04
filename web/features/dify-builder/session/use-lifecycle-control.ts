'use client'

import type { SessionControllerContext } from './controller-types'
import { useSetAtom, useStore } from 'jotai'
import { useCallback } from 'react'
import { controlSessionConversation, getSession } from './client'
import { requestErrorStatus, UNEXPECTED_EOF_ERROR } from './errors'
import {
  difyBuilderActiveCommandAtom,
  difyBuilderLifecycleControlAtom,
  difyBuilderSessionBusyAtom,
  difyBuilderSessionLastErrorAtom,
  difyBuilderSessionViewAtom,
  difyBuilderTaskControlAtom,
  isUnknownFixControl,
} from './state'

export function useDifyBuilderLifecycleControl({
  t,
  abortRef,
  lifecycleAbortRef,
  traceRef,
  syncConversation,
  isolateClearedConversation,
  applySessionView,
  lifecycleError,
}: Pick<
  SessionControllerContext,
  | 't'
  | 'abortRef'
  | 'lifecycleAbortRef'
  | 'traceRef'
  | 'syncConversation'
  | 'isolateClearedConversation'
  | 'applySessionView'
  | 'lifecycleError'
>) {
  const store = useStore()

  const setActiveCommand = useSetAtom(difyBuilderActiveCommandAtom)

  const setView = useSetAtom(difyBuilderSessionViewAtom)

  const setLastError = useSetAtom(difyBuilderSessionLastErrorAtom)

  const setIsBusy = useSetAtom(difyBuilderSessionBusyAtom)

  const controlConversation = useCallback(
    async (operation: 'clear' | 'abandon') => {
      let view = store.get(difyBuilderSessionViewAtom)
      const previousControl = store.get(difyBuilderLifecycleControlAtom)
      const escapeFix = operation === 'clear' && isUnknownFixControl(previousControl)
      if (
        !view ||
        (operation === 'clear' && store.get(difyBuilderSessionBusyAtom) && !escapeFix) ||
        store.get(difyBuilderTaskControlAtom) ||
        (previousControl && !escapeFix)
      )
        return false
      const controller = new AbortController()
      lifecycleAbortRef.current = controller
      setLastError('')
      const body = {
        base_version: view.version,
        expected_task_id: view.task_id ?? '',
        client_action_id: globalThis.crypto.randomUUID(),
      }
      let control = {
        operation,
        phase: 'pending' as const,
        sessionId: view.session_id,
        clientActionId: body.client_action_id,
        baseVersion: body.base_version,
        expectedTaskId: body.expected_task_id,
      }
      store.set(difyBuilderLifecycleControlAtom, control)
      let posted = false
      try {
        if (escapeFix) {
          const fresh = await getSession(view.session_id, controller.signal)
          if (
            controller.signal.aborted ||
            fresh.session_id !== view.session_id ||
            fresh.conversation_cleared
          )
            throw new Error(UNEXPECTED_EOF_ERROR)
          view = fresh
          body.base_version = fresh.version
          body.expected_task_id = fresh.task_id ?? ''
          control = {
            ...control,
            baseVersion: fresh.version,
            expectedTaskId: body.expected_task_id,
          }
          store.set(difyBuilderLifecycleControlAtom, control)
        }
        traceRef.current.append({ dir: 'out', kind: `conversation_${operation}`, payload: body })
        posted = true
        const receipt = await controlSessionConversation(
          view.session_id,
          operation,
          body,
          controller.signal,
        )
        if (
          controller.signal.aborted ||
          store.get(difyBuilderSessionViewAtom)?.session_id !== view.session_id
        )
          return false
        traceRef.current.append({
          dir: 'in',
          kind: `conversation_${operation}_ack`,
          payload: receipt,
        })
        if (
          receipt.session_id !== view.session_id ||
          receipt.last_command_id !== body.client_action_id ||
          (body.expected_task_id && receipt.task_id !== body.expected_task_id) ||
          receipt.conversation_cleared !== (operation === 'clear')
        ) {
          store.set(difyBuilderLifecycleControlAtom, { ...control, phase: 'unknown' })
          setLastError(t(($) => $['taskControl.unknown']))
          return false
        }
        if (receipt.conversation_cleared) {
          setView((current) =>
            current
              ? {
                  ...current,
                  version: receipt.version,
                  last_command_id: receipt.last_command_id,
                  conversation_cleared: true,
                  lifecycle_settlement: receipt.settlement,
                  task_status: receipt.task_status,
                }
              : null,
          )
          isolateClearedConversation()
        }
        if (operation === 'abandon') {
          abortRef.current?.abort()
          abortRef.current = null
          setIsBusy(false)
          setActiveCommand(null)
        }
        if (receipt.settlement !== 'settled') {
          store.set(difyBuilderLifecycleControlAtom, { ...control, phase: 'unknown' })
          setLastError(t(($) => $['taskControl.unknown']))
          return false
        }
        if (operation === 'abandon') {
          const snapshot = await getSession(view.session_id, controller.signal)
          if (controller.signal.aborted) return false
          applySessionView(snapshot)
          if (
            !(await syncConversation(
              view.session_id,
              snapshot.conversation_last_seq,
              controller,
              true,
            ))
          )
            throw new Error(UNEXPECTED_EOF_ERROR)
        }
        store.set(difyBuilderLifecycleControlAtom, null)
        return true
      } catch (error) {
        await lifecycleError(operation, error, controller)
        const status = requestErrorStatus(error)
        if (
          escapeFix &&
          !controller.signal.aborted &&
          (!posted || (status && status >= 400 && status < 500))
        )
          store.set(difyBuilderLifecycleControlAtom, previousControl)
        return false
      } finally {
        if (lifecycleAbortRef.current === controller) lifecycleAbortRef.current = null
      }
    },
    [
      applySessionView,
      isolateClearedConversation,
      lifecycleError,
      setActiveCommand,
      setIsBusy,
      setLastError,
      setView,
      store,
      syncConversation,
      t,
      lifecycleAbortRef,
      traceRef,
      abortRef,
    ],
  )

  const clearConversation = useCallback(() => controlConversation('clear'), [controlConversation])

  const abandonTask = useCallback(() => controlConversation('abandon'), [controlConversation])

  return { clearConversation, abandonTask }
}
