'use client'

import type { DifyBuilderStreamEventResponse } from '@dify/contracts/api/console/dify-builder/types.gen'
import type { SessionView } from '../types'
import type { SessionStreamOutcome } from './types'
import { useStore } from 'jotai'
import { useCallback, useEffect, useEffectEvent, useRef } from 'react'
import { getSessionStream } from './client'
import {
  requestErrorCode,
  requestErrorStatus,
  streamErrorMessage,
  UNEXPECTED_EOF_ERROR,
} from './errors'
import { difyBuilderActiveSessionIdAtom } from './state'

const RECONNECT_DELAY_MS = 1000
const MAX_RECENT_OUTCOMES = 16

type StreamUpdate = {
  view?: SessionView
  outcome?: SessionStreamOutcome
  started?: true
}

class SessionObservation {
  readonly sessionId: string
  readonly controller = new AbortController()
  readonly outcomes = new Map<string, SessionStreamOutcome>()
  ready = false
  view?: SessionView
  latestOutcome?: SessionStreamOutcome
  failure?: { error: unknown }
  private readonly listeners = new Set<() => void>()

  constructor(sessionId: string) {
    this.sessionId = sessionId
  }

  notify() {
    for (const listener of this.listeners) listener()
  }

  record(outcome: SessionStreamOutcome) {
    this.latestOutcome = outcome
    if (outcome.finishedCommandId) {
      this.outcomes.set(outcome.finishedCommandId, outcome)
      if (this.outcomes.size > MAX_RECENT_OUTCOMES) {
        const oldest = this.outcomes.keys().next()
        if (!oldest.done) this.outcomes.delete(oldest.value)
      }
    }
  }

  waitFor<T>(read: (current: SessionObservation) => T | undefined, signal: AbortSignal) {
    return new Promise<T>((resolve, reject) => {
      const lifetime = AbortSignal.any([signal, this.controller.signal])
      const check = () => {
        const failure = lifetime.aborted ? { error: lifetime.reason } : this.failure
        const result = failure ? undefined : read(this)
        if (failure) reject(failure.error)
        else if (result !== undefined) resolve(result)
        else return
        this.listeners.delete(check)
        lifetime.removeEventListener('abort', check)
      }
      this.listeners.add(check)
      lifetime.addEventListener('abort', check, { once: true })
      check()
    })
  }
}

const reconnectDelay = (signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout>
    const finish = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    timer = setTimeout(finish, RECONNECT_DELAY_MS)
    if (signal.aborted) finish()
    else signal.addEventListener('abort', finish, { once: true })
  })

export function useDifyBuilderSessionStream({
  enabled,
  onEvent,
  onDisconnect,
}: {
  enabled: boolean
  onEvent: (
    event: DifyBuilderStreamEventResponse,
    controller: AbortController,
  ) => Promise<StreamUpdate | void>
  onDisconnect: () => void
}) {
  const store = useStore()
  const observationRef = useRef<SessionObservation | null>(null)
  const projectEvent = useEffectEvent(onEvent)
  const disconnect = useEffectEvent(onDisconnect)

  useEffect(() => {
    if (!enabled) return

    const observe = async (observation: SessionObservation) => {
      const { controller, sessionId } = observation
      const { signal } = controller
      let connected = false
      let initialFailures = 0
      while (!signal.aborted) {
        observation.failure = undefined
        try {
          const events = await getSessionStream(sessionId, signal)
          for await (const event of events) {
            if (signal.aborted) return
            if (event.data.session_id && event.data.session_id !== sessionId) continue
            if (event.event === 'error' && !event.data.command_id)
              throw new Error(streamErrorMessage(event.data))
            const update = await projectEvent(event, controller)
            if (signal.aborted) return
            if (update?.view) observation.view = update.view
            if (update?.outcome) observation.record(update.outcome)
            if (event.event === 'session_ready' && update?.view) {
              observation.ready = true
              connected = true
            }
            if (update?.started && observation.view)
              observation.view = { ...observation.view, command_pending: true }
            if (update) observation.notify()
            if (update?.view?.conversation_cleared) return
          }
          if (!observation.ready) throw new Error(UNEXPECTED_EOF_ERROR)
        } catch (error) {
          if (signal.aborted) return
          const status = requestErrorStatus(error)
          const forbidden =
            status === 403 && (await requestErrorCode(error)) !== 'feature_unavailable'
          if (signal.aborted) return
          if (forbidden || status === 401 || status === 404 || status === 410) {
            observation.failure = { error }
            observation.notify()
            return
          }
          if (!connected && status !== 403 && ++initialFailures === 3) {
            observation.failure = { error }
            observation.notify()
            return
          }
        }
        if (signal.aborted) return
        observation.ready = false
        if (connected) disconnect()
        await reconnectDelay(signal)
      }
    }

    const connect = () => {
      const sessionId = store.get(difyBuilderActiveSessionIdAtom)
      if (sessionId === observationRef.current?.sessionId) return
      observationRef.current?.controller.abort()
      const observation = sessionId ? new SessionObservation(sessionId) : null
      observationRef.current = observation
      if (observation) void observe(observation)
    }
    const unsubscribe = store.sub(difyBuilderActiveSessionIdAtom, connect)
    connect()
    return () => {
      unsubscribe()
      observationRef.current?.controller.abort()
      observationRef.current = null
    }
  }, [enabled, store])

  return useCallback(async (sessionId: string, signal: AbortSignal) => {
    const observation = observationRef.current
    if (observation?.sessionId !== sessionId) throw new Error(UNEXPECTED_EOF_ERROR)
    await observation.waitFor(
      (current) => (current.ready ? true : undefined),
      AbortSignal.any([signal, AbortSignal.timeout(15000)]),
    )
    return observation
  }, [])
}
