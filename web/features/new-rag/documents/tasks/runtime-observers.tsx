'use client'

import type { DocumentProcessingTask } from '../models'
import type { ProcessingTaskEvent } from './events'
import { TaskEventObserver } from './event-observer'

export type TaskRuntimeObserverContract = {
  eventCursors: ReadonlyMap<string, string>
  generation: (taskId: string) => number
  onEvent: (taskId: string, taskVersion: string, event: ProcessingTaskEvent) => boolean
  onEventCursorChange: (taskId: string, eventId?: string) => void
  onPermissionDenied: (taskId: string, taskVersion: string) => void
  tasks: DocumentProcessingTask[]
  version: (task: DocumentProcessingTask) => string
}

export function TaskRuntimeObservers({
  knowledgeSpaceId,
  observers,
}: {
  knowledgeSpaceId: string
  observers: TaskRuntimeObserverContract
}) {
  return observers.tasks.map((task) => (
    <TaskEventObserver
      key={`${task.id}:${observers.generation(task.id)}`}
      documentId={task.documentId}
      knowledgeSpaceId={knowledgeSpaceId}
      lastEventId={observers.eventCursors.get(task.id)}
      onEvent={observers.onEvent}
      onLastEventIdChange={observers.onEventCursorChange}
      onPermissionDenied={observers.onPermissionDenied}
      taskId={task.id}
      taskVersion={observers.version(task)}
    />
  ))
}
