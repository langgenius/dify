'use client'

import type { SessionControllerContext } from './controller-types'
import { useSetAtom, useStore } from 'jotai'
import { useCallback } from 'react'
import { difyBuilderCanvasReadyAtom, difyBuilderLocalInteractionResponseAtom } from '../state'
import { controlSessionTask, getSession } from './client'
import { requestErrorMessage, requestErrorStatus, UNEXPECTED_EOF_ERROR } from './errors'
import { isActiveView } from './projection'
import {
  difyBuilderActiveCommandAtom,
  difyBuilderActiveSessionIdAtom,
  difyBuilderConversationLoadingAtom,
  difyBuilderLifecycleControlAtom,
  difyBuilderRetryableMessageAtom,
  difyBuilderSessionBusyAtom,
  difyBuilderSessionLastErrorAtom,
  difyBuilderSessionViewAtom,
  difyBuilderTaskControlAtom,
} from './state'

const waitForTaskSettlement = (signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout>
    const finish = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    timer = setTimeout(finish, 1000)
    if (signal.aborted) finish()
    else signal.addEventListener('abort', finish, { once: true })
  })

export function useDifyBuilderTaskControl({
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
  prepareCommand,
  runEvents,
}: Pick<
  SessionControllerContext,
  | 't'
  | 'executionProgress'
  | 'reasoningBuffer'
  | 'streamingTurnBuffer'
  | 'abortRef'
  | 'pendingTaskControlRef'
  | 'nativeObservationRef'
  | 'pendingActionRef'
  | 'pendingMessageRef'
  | 'pendingRetestRef'
  | 'traceRef'
  | 'syncConversation'
  | 'applySessionView'
  | 'reconcileSession'
  | 'prepareCommand'
  | 'runEvents'
>) {
  const store = useStore()

  const setActiveCommand = useSetAtom(difyBuilderActiveCommandAtom)

  const setConversationLoading = useSetAtom(difyBuilderConversationLoadingAtom)

  const setRetryableMessage = useSetAtom(difyBuilderRetryableMessageAtom)

  const setLastError = useSetAtom(difyBuilderSessionLastErrorAtom)

  const setIsBusy = useSetAtom(difyBuilderSessionBusyAtom)

  const setTaskControl = useSetAtom(difyBuilderTaskControlAtom)

  const controlTask = useCallback(
    async (operation: 'stop' | 'resume') => {
      if (store.get(difyBuilderLifecycleControlAtom)) return false
      const view = store.get(difyBuilderSessionViewAtom)
      const command = store.get(difyBuilderActiveCommandAtom)
      const sessionId = store.get(difyBuilderActiveSessionIdAtom) ?? view?.session_id
      const control = store.get(difyBuilderTaskControlAtom)
      const pending = pendingTaskControlRef.current
      if (!sessionId || (control && control.phase !== 'unknown')) return false
      if (pending && (pending.sessionId !== sessionId || pending.operation !== operation))
        return false
      if (!pending) {
        if (operation === 'stop') {
          if ((command?.run_status ?? view?.run_status) !== 'processing') return false
        } else if (
          view?.run_status !== 'paused' ||
          view.canvas_read_only ||
          store.get(difyBuilderSessionBusyAtom) ||
          !store.get(difyBuilderCanvasReadyAtom)
        ) {
          return false
        }
      }

      // Retire the old response locally. The independent JSON request below
      // stops the server task; aborting the response alone cannot do that.
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      pendingRetestRef.current = null
      pendingActionRef.current = null
      pendingMessageRef.current = null
      setRetryableMessage(null)
      executionProgress.clear()
      reasoningBuffer.clear()
      streamingTurnBuffer.clear()
      setConversationLoading(false)
      store.set(difyBuilderLocalInteractionResponseAtom, null)
      // Take the existing save barrier before busy state locks the canvas.
      const preparation =
        operation === 'resume' && !pending ? prepareCommand?.(true, controller.signal) : undefined
      setTaskControl({ operation, phase: preparation ? 'saving' : 'pending' })
      setIsBusy(true)
      runEvents?.onCommandStarted?.()
      setLastError('')

      const readLatest = async () => {
        const observedAtStart = nativeObservationRef.current
        const snapshot = await getSession(sessionId, controller.signal)
        controller.signal.throwIfAborted()
        traceRef.current.append({
          dir: 'in',
          kind: 'session_snapshot',
          payload: snapshot,
          version: snapshot.version,
        })
        applySessionView(snapshot, observedAtStart)
        const latest = store.get(difyBuilderSessionViewAtom)!
        setActiveCommand(
          isActiveView(latest)
            ? {
                session_id: latest.session_id,
                version: latest.version,
                phase: latest.phase,
                run_status: latest.run_status,
              }
            : null,
        )
        const historyApplied = await syncConversation(
          sessionId,
          latest.conversation_last_seq,
          controller,
        )
        controller.signal.throwIfAborted()
        if (!historyApplied) throw new Error(UNEXPECTED_EOF_ERROR)
        return latest
      }
      const watchContinuation = async () => {
        const outcome = await reconcileSession(sessionId, controller)
        if (controller.signal.aborted) return false
        if (outcome?.terminalEvent !== 'command_finished' || !outcome.stateApplied) {
          setLastError(outcome?.terminalError || outcome?.transportError || UNEXPECTED_EOF_ERROR)
          return false
        }
        return outcome.terminalRunStatus !== 'failed'
      }

      try {
        await preparation
        controller.signal.throwIfAborted()
        let intent = pending
        if (!intent) {
          const latest = operation === 'resume' ? await readLatest() : view
          if (operation === 'resume' && latest?.run_status !== 'paused') {
            setTaskControl(null)
            setLastError(t(($) => $['taskControl.conflict']))
            return false
          }
          intent = {
            sessionId,
            operation,
            body: {
              base_version: Math.max(latest?.version ?? 0, command?.version ?? 0),
              client_action_id: globalThis.crypto.randomUUID(),
              ...(operation === 'resume' && latest?.app_revision
                ? { base_app_revision: latest.app_revision.current }
                : {}),
            },
            acknowledged: false,
          }
          pendingTaskControlRef.current = intent
        } else {
          // An uncertain request is reconciled before replay, and replay keeps
          // the original body and ID even if the session has since advanced.
          const latest = await readLatest()
          if (intent.rejected) {
            pendingTaskControlRef.current = null
            setTaskControl(null)
            return false
          }
          intent.acknowledged ||= latest.last_command_id === intent.body.client_action_id
          if (
            (operation === 'stop' && latest.run_status === 'paused') ||
            (operation === 'resume' && latest.run_status !== 'paused') ||
            latest.run_status === 'complete' ||
            latest.run_status === 'failed'
          ) {
            pendingTaskControlRef.current = null
            setTaskControl(null)
            if (isActiveView(latest)) return await watchContinuation()
            return latest.run_status !== 'failed'
          }
        }

        setTaskControl({ operation, phase: 'pending' })
        if (!intent.acknowledged) {
          traceRef.current.append({
            dir: 'out',
            kind: `task_${operation}`,
            payload: { session_id: sessionId, ...intent.body },
          })
          const receipt = await controlSessionTask(
            sessionId,
            operation,
            intent.body,
            controller.signal,
          )
          controller.signal.throwIfAborted()
          intent.acknowledged = true
          // ACKs are immutable historical receipts, never current projections.
          traceRef.current.append({
            dir: 'in',
            kind: `task_${operation}_ack`,
            payload: receipt,
            version: receipt.version,
          })
        }

        while (!controller.signal.aborted) {
          const latest = await readLatest()
          if (
            (operation === 'stop' &&
              latest.run_status === 'processing' &&
              (latest.version <= intent.body.base_version ||
                latest.last_command_id === intent.body.client_action_id)) ||
            (operation === 'resume' &&
              latest.run_status === 'paused' &&
              latest.version <= intent.body.base_version)
          ) {
            await waitForTaskSettlement(controller.signal)
            continue
          }
          pendingTaskControlRef.current = null
          setTaskControl(null)
          if (isActiveView(latest)) {
            // Resume watches the same session through the existing SSE owner.
            return await watchContinuation()
          }
          return latest.run_status !== 'failed'
        }
        return false
      } catch (error) {
        if (controller.signal.aborted) return false
        const status = requestErrorStatus(error)
        const message = await requestErrorMessage(error)
        if (controller.signal.aborted) return false
        setLastError(status === 409 ? t(($) => $['taskControl.conflict']) : message)
        if (status !== undefined && status >= 400 && status < 500) {
          const intent = pendingTaskControlRef.current
          if (intent) intent.rejected = true
          try {
            await readLatest()
            pendingTaskControlRef.current = null
            setTaskControl(null)
          } catch {
            if (!controller.signal.aborted)
              setTaskControl(intent ? { operation, phase: 'unknown' } : null)
          }
        } else {
          setTaskControl(pendingTaskControlRef.current ? { operation, phase: 'unknown' } : null)
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
      applySessionView,
      executionProgress,
      prepareCommand,
      reasoningBuffer,
      reconcileSession,
      runEvents,
      setActiveCommand,
      setConversationLoading,
      setIsBusy,
      setLastError,
      setRetryableMessage,
      setTaskControl,
      store,
      streamingTurnBuffer,
      syncConversation,
      t,
      pendingTaskControlRef,
      abortRef,
      pendingRetestRef,
      pendingActionRef,
      pendingMessageRef,
      nativeObservationRef,
      traceRef,
    ],
  )

  const stopTask = useCallback(() => controlTask('stop'), [controlTask])

  const resumeTask = useCallback(() => controlTask('resume'), [controlTask])

  return { stopTask, resumeTask }
}
