import type { DocumentProcessingTaskEvent } from '@dify/contracts/knowledge-fs/types.gen'
import { getEventMeta } from '@orpc/client'
import { consoleClient } from '@/service/client'

type ProcessingTaskEventWithId<T extends DocumentProcessingTaskEvent> = T & {
  id: string
}

export type ProcessingTaskProgressEvent = ProcessingTaskEventWithId<
  Extract<DocumentProcessingTaskEvent, { event: 'progress' }>
>

type ProcessingTaskTerminalEvent = ProcessingTaskEventWithId<
  Extract<DocumentProcessingTaskEvent, { event: 'terminal' }>
>

export type ProcessingTaskEvent = ProcessingTaskProgressEvent | ProcessingTaskTerminalEvent

type StreamProcessingTaskEventsInput = {
  documentId: string
  knowledgeSpaceId: string
  lastEventId?: string
  signal?: AbortSignal
  taskId: string
}

export async function* streamProcessingTaskEvents(
  input: StreamProcessingTaskEventsInput,
): AsyncGenerator<ProcessingTaskEvent> {
  const events =
    await consoleClient.knowledgeFs.getKnowledgeSpacesByIdDocumentsByDocumentIdProcessingTasksByTaskIdEvents(
      {
        headers: input.lastEventId ? { 'last-event-id': input.lastEventId } : undefined,
        params: {
          documentId: input.documentId,
          id: input.knowledgeSpaceId,
          taskId: input.taskId,
        },
      },
      {
        context: { silent: true },
        signal: input.signal,
      },
    )

  for await (const event of events) {
    const id = getEventMeta(event)?.id
    if (!id) throw new Error('KnowledgeFS processing task event is missing an event id')
    yield { ...event, id }
  }
}
