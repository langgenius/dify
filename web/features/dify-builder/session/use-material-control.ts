'use client'

import type { DifyBuilderAttachmentPayload } from '@dify/contracts/api/console/dify-builder/types.gen'
import type { SessionControllerContext } from './controller-types'
import { useSetAtom, useStore } from 'jotai'
import { useCallback } from 'react'
import { sendSessionMessage } from './client'
import {
  requestErrorMessage,
  requestErrorStatus,
  streamErrorMessage,
  UNEXPECTED_EOF_ERROR,
} from './errors'
import {
  difyBuilderActiveCommandAtom,
  difyBuilderActiveSessionIdAtom,
  difyBuilderLifecycleControlAtom,
  difyBuilderMaterialControlAtom,
  difyBuilderSessionLastErrorAtom,
  difyBuilderSessionViewAtom,
  difyBuilderTaskControlAtom,
} from './state'

export function useDifyBuilderMaterialControl({
  onAttachmentsAccepted,
  materialAbortRef,
  traceRef,
  applySessionView,
  consumeStream,
}: Pick<
  SessionControllerContext,
  'onAttachmentsAccepted' | 'materialAbortRef' | 'traceRef' | 'applySessionView' | 'consumeStream'
>) {
  const store = useStore()

  const setLastError = useSetAtom(difyBuilderSessionLastErrorAtom)

  const sendMaterial = useCallback(
    async (text: string, attachments: DifyBuilderAttachmentPayload[]) => {
      const view = store.get(difyBuilderSessionViewAtom)
      const command = store.get(difyBuilderActiveCommandAtom)
      const sessionId = view?.session_id ?? store.get(difyBuilderActiveSessionIdAtom)
      const version = view?.version ?? command?.version
      if (
        !sessionId ||
        !version ||
        attachments.length > 5 ||
        (!text.trim() && !attachments.length) ||
        view?.conversation_cleared ||
        store.get(difyBuilderMaterialControlAtom) ||
        store.get(difyBuilderLifecycleControlAtom) ||
        store.get(difyBuilderTaskControlAtom)
      )
        return false
      const controller = new AbortController()
      materialAbortRef.current = controller
      const clientTurnId = globalThis.crypto.randomUUID()
      const material = { phase: 'pending' as const, clientTurnId, text, attachments }
      store.set(difyBuilderMaterialControlAtom, material)
      setLastError('')
      traceRef.current.append({
        dir: 'out',
        kind: 'material_message',
        payload: {
          text,
          attachments,
          base_version: version,
          client_turn_id: clientTurnId,
        },
      })
      try {
        const response = await sendSessionMessage(
          sessionId,
          text,
          version,
          clientTurnId,
          controller.signal,
          attachments,
        )
        const iterator = response[Symbol.asyncIterator]()
        const first = await iterator.next()
        const events = (async function* () {
          try {
            if (!first.done) yield first.value
            while (true) {
              const next = await iterator.next()
              if (next.done) return
              yield next.value
            }
          } finally {
            await iterator.return?.()
          }
        })()
        if (!first.done && first.value.event === 'command_started' && first.value.data.command_id) {
          // A newly admitted consume-material turn has its own stream; it never
          // aborts an earlier response or runs the draft-save barrier.
          await consumeStream(events, controller, sessionId)
        } else {
          for await (const event of events) {
            if (controller.signal.aborted) return false
            traceRef.current.append({ dir: 'in', kind: event.event, payload: event.data })
            if (event.event === 'error') throw new Error(streamErrorMessage(event.data))
            if (event.event === 'command_finished') {
              const current = store.get(difyBuilderSessionViewAtom)
              applySessionView({ ...event.data, last_command_id: current?.last_command_id ?? '' })
              break
            }
          }
        }
        if (controller.signal.aborted) return false
        const admitted = store
          .get(difyBuilderSessionViewAtom)
          ?.attachments?.some((receipt) => receipt.client_turn_id === clientTurnId)
        if (!admitted) throw new Error(UNEXPECTED_EOF_ERROR)
        store.set(difyBuilderMaterialControlAtom, null)
        onAttachmentsAccepted?.(attachments, text)
        return true
      } catch (error) {
        if (controller.signal.aborted) return false
        const status = requestErrorStatus(error)
        setLastError(await requestErrorMessage(error))
        store.set(
          difyBuilderMaterialControlAtom,
          status && status >= 400 && status < 500 ? null : { ...material, phase: 'unknown' },
        )
        return false
      } finally {
        if (materialAbortRef.current === controller) materialAbortRef.current = null
      }
    },
    [
      applySessionView,
      consumeStream,
      onAttachmentsAccepted,
      setLastError,
      store,
      materialAbortRef,
      traceRef,
    ],
  )

  return { sendMaterial }
}
