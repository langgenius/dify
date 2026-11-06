'use client'

import type { ConversationItem, SessionView } from '../types'
import type { SessionControllerContext } from './controller-types'
import { useAtomValue, useSetAtom, useStore } from 'jotai'
import { useEffect } from 'react'
import { getSession, getSessionStream } from './client'
import { requestErrorMessage, requestErrorStatus, streamErrorMessage } from './errors'
import { hasConversationRange, mergeConversationPage } from './projection'
import {
  difyBuilderActiveSessionIdAtom,
  difyBuilderConversationAtom,
  difyBuilderSessionLastErrorAtom,
  difyBuilderSessionViewAtom,
} from './state'

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

export function useDifyBuilderNativeExecution({
  nativeObservationRef,
  traceRef,
  confirmLocalUserMessage,
  syncConversation,
  syncConversationRange,
  applySessionView,
}: Pick<
  SessionControllerContext,
  | 'nativeObservationRef'
  | 'traceRef'
  | 'confirmLocalUserMessage'
  | 'syncConversation'
  | 'syncConversationRange'
  | 'applySessionView'
>) {
  const store = useStore()

  const setConversation = useSetAtom(difyBuilderConversationAtom)

  const setLastError = useSetAtom(difyBuilderSessionLastErrorAtom)

  const observedView = useAtomValue(difyBuilderSessionViewAtom)

  const observedSessionId = observedView?.test_execution ? observedView.session_id : null

  const observedRequestId = observedView?.test_execution?.request_id

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
            if (
              controller.signal.aborted ||
              store.get(difyBuilderSessionViewAtom)?.conversation_cleared
            )
              return
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
    nativeObservationRef,
    traceRef,
  ])
}
