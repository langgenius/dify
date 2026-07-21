'use client'

import type { ProcessingTaskEvent } from './services/processing-task-events'
import { useEffect, useRef } from 'react'
import { streamProcessingTaskEvents } from './services/processing-task-events'

const TASK_EVENT_RECONNECT_DELAY = 1000
const TASK_EVENT_MAX_RECONNECT_DELAY = 30000

function waitForTaskEventReconnect(signal: AbortSignal, delay: number) {
  return new Promise<void>((resolve) => {
    const timeout = window.setTimeout(finish, delay)
    signal.addEventListener('abort', finish, { once: true })

    function finish() {
      window.clearTimeout(timeout)
      signal.removeEventListener('abort', finish)
      resolve()
    }
  })
}

export function TaskEventObserver({
  documentId,
  knowledgeSpaceId,
  lastEventId,
  onEvent,
  onLastEventIdChange,
  taskId,
  taskVersion,
}: {
  documentId: string
  knowledgeSpaceId: string
  lastEventId?: string
  onEvent: (taskId: string, taskVersion: string, event: ProcessingTaskEvent) => boolean
  onLastEventIdChange: (taskId: string, eventId?: string) => void
  taskId: string
  taskVersion: string
}) {
  const initialLastEventIdRef = useRef(lastEventId)
  const latestTaskVersionRef = useRef(taskVersion)
  const streamTaskVersionRef = useRef(taskVersion)
  latestTaskVersionRef.current = taskVersion

  useEffect(() => {
    const controller = new AbortController()
    let resumeEventId = initialLastEventIdRef.current
    void (async () => {
      let reconnectDelay = TASK_EVENT_RECONNECT_DELAY
      while (!controller.signal.aborted) {
        try {
          for await (const event of streamProcessingTaskEvents({
            documentId,
            knowledgeSpaceId,
            lastEventId: resumeEventId,
            signal: controller.signal,
            taskId,
          })) {
            if (controller.signal.aborted) return
            resumeEventId = event.id
            onLastEventIdChange(taskId, event.id)
            if (event.event === 'progress') streamTaskVersionRef.current = event.data.updatedAt
            const accepted = onEvent(taskId, streamTaskVersionRef.current, event)
            if (!accepted) {
              resumeEventId = undefined
              onLastEventIdChange(taskId)
              streamTaskVersionRef.current = latestTaskVersionRef.current
              break
            }
            reconnectDelay = TASK_EVENT_RECONNECT_DELAY
            if (event.event === 'terminal') {
              onLastEventIdChange(taskId)
              return
            }
          }
        } catch {
          if (controller.signal.aborted) return
        }
        await waitForTaskEventReconnect(controller.signal, reconnectDelay)
        reconnectDelay = Math.min(reconnectDelay * 2, TASK_EVENT_MAX_RECONNECT_DELAY)
      }
    })()
    return () => controller.abort()
  }, [documentId, knowledgeSpaceId, onEvent, onLastEventIdChange, taskId])

  return null
}
