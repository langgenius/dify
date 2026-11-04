'use client'

import type { SessionControllerContext } from './controller-types'
import { useSetAtom, useStore } from 'jotai'
import { useCallback } from 'react'
import { getSessionFixControl } from './client'
import { requestErrorMessage, requestErrorStatus } from './errors'
import {
  difyBuilderLifecycleControlAtom,
  difyBuilderSessionLastErrorAtom,
  isUnknownFixControl,
} from './state'

export function useDifyBuilderLifecycleRecovery({
  t,
  lifecycleAbortRef,
}: Pick<SessionControllerContext, 't' | 'lifecycleAbortRef'>) {
  const store = useStore()

  const setLastError = useSetAtom(difyBuilderSessionLastErrorAtom)

  const readFixControl = useCallback(
    async (sessionId: string, controller: AbortController) => {
      const control = store.get(difyBuilderLifecycleControlAtom)
      if (!isUnknownFixControl(control) || control.sessionId !== sessionId) return
      if (control.operation !== 'fix' && (!control.fixIntentId || !control.expectedTaskId)) return
      try {
        const receipt = await getSessionFixControl(
          sessionId,
          {
            operation: control.operation,
            client_action_id: control.clientActionId,
            base_version: control.baseVersion,
            ...(control.fixIntentId ? { fix_intent_id: control.fixIntentId } : {}),
            ...(control.expectedTaskId ? { expected_task_id: control.expectedTaskId } : {}),
          },
          controller.signal,
        )
        if (controller.signal.aborted || store.get(difyBuilderLifecycleControlAtom) !== control)
          return
        if (
          receipt.acknowledged &&
          receipt.session_id === sessionId &&
          receipt.operation === control.operation &&
          receipt.client_action_id === control.clientActionId &&
          receipt.base_version === control.baseVersion &&
          (!control.expectedTaskId || receipt.target_task_id === control.expectedTaskId) &&
          (!control.fixIntentId || receipt.fix_intent_id === control.fixIntentId)
        ) {
          store.set(difyBuilderLifecycleControlAtom, null)
          setLastError('')
          return
        }
      } catch {
        // A missing receipt (including a deduplicated alias) cannot prove rejection
        // or success. Recovery never replays intake/decisions or dispatches work.
      }
      if (!controller.signal.aborted && store.get(difyBuilderLifecycleControlAtom) === control)
        setLastError(t(($) => $['taskControl.unknown']))
    },
    [setLastError, store, t],
  )

  const lifecycleError = useCallback(
    async (
      operation: 'clear' | 'abandon' | 'fix' | 'dismiss_fix' | 'stop_and_switch_fix',
      error: unknown,
      controller: AbortController,
    ) => {
      const status = requestErrorStatus(error)
      const message = await requestErrorMessage(error)
      if (controller.signal.aborted || lifecycleAbortRef.current !== controller) return
      const rejected = status !== undefined && status >= 400 && status < 500
      const control = store.get(difyBuilderLifecycleControlAtom)
      if (!control) return
      store.set(
        difyBuilderLifecycleControlAtom,
        rejected ? null : { ...control, operation, phase: 'unknown' },
      )
      setLastError(status === 409 ? t(($) => $['taskControl.conflict']) : message)
    },
    [setLastError, store, t, lifecycleAbortRef],
  )

  return { readFixControl, lifecycleError }
}
