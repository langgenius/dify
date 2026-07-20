'use client'

import type { ProcessingTaskEvent } from './services/processing-task-events'
import { useEffect, useRef } from 'react'
import { streamProcessingTaskEvents } from './services/processing-task-events'

const TASK_EVENT_RECONNECT_DELAY = 1000

function waitForTaskEventReconnect(signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timeout = window.setTimeout(finish, TASK_EVENT_RECONNECT_DELAY)
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
  onError,
  onEvent,
  taskId,
  taskVersion,
}: {
  documentId: string
  knowledgeSpaceId: string
  onError: () => void
  onEvent: (taskId: string, taskVersion: string, event: ProcessingTaskEvent) => void
  taskId: string
  taskVersion: string
}) {
  const lastEventIdRef = useRef<string | undefined>(undefined)
  const taskVersionRef = useRef(taskVersion)
  taskVersionRef.current = taskVersion

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      while (!controller.signal.aborted) {
        try {
          for await (const event of streamProcessingTaskEvents({
            documentId,
            knowledgeSpaceId,
            lastEventId: lastEventIdRef.current,
            signal: controller.signal,
            taskId,
          })) {
            if (controller.signal.aborted) return
            lastEventIdRef.current = event.id
            onEvent(taskId, taskVersionRef.current, event)
            if (event.event === 'terminal') return
          }
        } catch {
          if (controller.signal.aborted) return
        }
        onError()
        await waitForTaskEventReconnect(controller.signal)
      }
    })()
    return () => controller.abort()
  }, [documentId, knowledgeSpaceId, onError, onEvent, taskId])

  return null
}
