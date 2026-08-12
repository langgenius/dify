import type { DocumentProcessingTask, DocumentProcessingTaskEvent } from '../document-models'
import { consoleClient } from '@/service/client'
import { documentTaskFromApi } from '../document-models'

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

type PendingSubscriptionRead = {
  reject: (error: unknown) => void
  resolve: (result: IteratorResult<ProcessingTaskEvent>) => void
}

type TaskPollingHub = {
  controller: AbortController
  knowledgeSpaceId: string
  revision: number
  subscriptions: Set<TaskSubscription>
  wake?: () => void
}

type TaskSubscription = {
  abortListener?: () => void
  closed: boolean
  failed: boolean
  failure?: unknown
  hub: TaskPollingHub
  input: StreamProcessingTaskEventsInput
  lastEventId?: string
  pendingRead?: PendingSubscriptionRead
  queuedEvents: ProcessingTaskEvent[]
}

const POLL_INTERVAL_MS = 5000
const TASK_PAGE_SIZE = 100
const taskPollingHubs = new Map<string, TaskPollingHub>()

function abortError(signal: AbortSignal) {
  return signal.reason ?? new DOMException('Aborted', 'AbortError')
}

async function waitForNextPoll(hub: TaskPollingHub) {
  const { signal } = hub.controller
  if (signal.aborted) throw abortError(signal)

  await new Promise<void>((resolve, reject) => {
    let settled = false
    const timeout = setTimeout(() => finish(false), POLL_INTERVAL_MS)
    const onAbort = () => finish(true, abortError(signal))
    const wake = () => finish(false)

    hub.wake = wake
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()

    function finish(rejected: boolean, error?: unknown) {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal.removeEventListener('abort', onAbort)
      if (hub.wake === wake) hub.wake = undefined
      if (rejected) reject(error)
      else resolve()
    }
  })
}

function getPollingHub(knowledgeSpaceId: string) {
  const existing = taskPollingHubs.get(knowledgeSpaceId)
  if (existing && !existing.controller.signal.aborted) return existing

  const hub: TaskPollingHub = {
    controller: new AbortController(),
    knowledgeSpaceId,
    revision: 0,
    subscriptions: new Set(),
  }
  taskPollingHubs.set(knowledgeSpaceId, hub)
  void Promise.resolve().then(() => runPollingHub(hub))
  return hub
}

function subscribe(input: StreamProcessingTaskEventsInput) {
  const hub = getPollingHub(input.knowledgeSpaceId)
  const subscription: TaskSubscription = {
    closed: false,
    failed: false,
    hub,
    input,
    lastEventId: input.lastEventId,
    queuedEvents: [],
  }
  hub.subscriptions.add(subscription)
  hub.revision += 1
  hub.wake?.()

  if (input.signal) {
    subscription.abortListener = () => closeSubscription(subscription)
    input.signal.addEventListener('abort', subscription.abortListener, { once: true })
    if (input.signal.aborted) closeSubscription(subscription)
  }
  return subscription
}

function removeSubscription(subscription: TaskSubscription) {
  const { hub, input } = subscription
  if (subscription.abortListener && input.signal)
    input.signal.removeEventListener('abort', subscription.abortListener)
  subscription.abortListener = undefined
  if (!hub.subscriptions.delete(subscription)) return
  if (hub.subscriptions.size === 0) hub.controller.abort()
}

function closeSubscription(subscription: TaskSubscription) {
  if (subscription.closed) return
  subscription.closed = true
  removeSubscription(subscription)
  subscription.pendingRead?.resolve({ done: true, value: undefined })
  subscription.pendingRead = undefined
}

function failSubscription(subscription: TaskSubscription, error: unknown) {
  if (subscription.closed) return
  subscription.closed = true
  subscription.failed = true
  subscription.failure = error
  removeSubscription(subscription)
  subscription.pendingRead?.reject(error)
  subscription.pendingRead = undefined
}

function pushSubscriptionEvent(subscription: TaskSubscription, event: ProcessingTaskEvent) {
  if (subscription.closed) return
  subscription.lastEventId = event.id
  if (subscription.pendingRead) {
    subscription.pendingRead.resolve({ done: false, value: event })
    subscription.pendingRead = undefined
    return
  }
  subscription.queuedEvents.push(event)
}

function readSubscriptionEvent(
  subscription: TaskSubscription,
): Promise<IteratorResult<ProcessingTaskEvent>> {
  const queued = subscription.queuedEvents.shift()
  if (queued) return Promise.resolve({ done: false, value: queued })
  if (subscription.failed) return Promise.reject(subscription.failure)
  if (subscription.closed) return Promise.resolve({ done: true, value: undefined })
  if (subscription.pendingRead)
    return Promise.reject(
      new Error('KnowledgeFS task event subscription already has a pending read'),
    )

  return new Promise<IteratorResult<ProcessingTaskEvent>>((resolve, reject) => {
    subscription.pendingRead = { reject, resolve }
  })
}

async function getTasks(hub: TaskPollingHub, subscriptions: readonly TaskSubscription[]) {
  const remaining = new Set(subscriptions)
  const tasks = new Map<TaskSubscription, DocumentProcessingTask>()
  let cursor: string | undefined
  do {
    const response = await consoleClient.knowledgeFs.spaces.byControlSpaceId.backgroundTasks.get(
      {
        params: { control_space_id: hub.knowledgeSpaceId },
        query: { ...(cursor ? { cursor } : {}), limit: TASK_PAGE_SIZE },
      },
      { context: { silent: true }, signal: hub.controller.signal },
    )
    const candidatesById = new Map(response.data.map((candidate) => [candidate.id, candidate]))
    for (const subscription of remaining) {
      const candidate = candidatesById.get(subscription.input.taskId)
      if (!candidate || candidate.document_id !== subscription.input.documentId) continue
      const task = documentTaskFromApi(candidate)
      if (!task) continue
      tasks.set(subscription, task)
      remaining.delete(subscription)
    }
    cursor = response.next_cursor ?? undefined
  } while (cursor && remaining.size > 0)
  return tasks
}

function publishTask(subscription: TaskSubscription, task: DocumentProcessingTask) {
  const eventId = `${task.updatedAt}:${task.state}:${task.progressPercent}`
  const terminalState =
    task.state === 'succeeded' ||
    task.state === 'failed' ||
    task.state === 'canceled' ||
    task.state === 'superseded'
      ? task.state
      : undefined

  if (eventId !== subscription.lastEventId) {
    if (terminalState) {
      pushSubscriptionEvent(subscription, {
        data: { errorCode: task.errorCode, failure: task.failure, state: terminalState },
        event: 'terminal',
        id: eventId,
      })
    } else {
      pushSubscriptionEvent(subscription, {
        data: {
          progressPercent: task.progressPercent,
          stage: task.stage,
          state: task.state,
          updatedAt: task.updatedAt,
        },
        event: 'progress',
        id: eventId,
      })
    }
  }
  if (terminalState) closeSubscription(subscription)
}

async function runPollingHub(hub: TaskPollingHub) {
  try {
    while (!hub.controller.signal.aborted && hub.subscriptions.size > 0) {
      const revision = hub.revision
      const subscriptions = [...hub.subscriptions].filter((subscription) => !subscription.closed)
      if (subscriptions.length === 0) return

      const tasks = await getTasks(hub, subscriptions)
      for (const subscription of subscriptions) {
        if (subscription.closed) continue
        const task = tasks.get(subscription)
        if (task) publishTask(subscription, task)
        else closeSubscription(subscription)
      }
      if (hub.controller.signal.aborted || hub.subscriptions.size === 0) return
      if (hub.revision !== revision) continue
      await waitForNextPoll(hub)
    }
  } catch (error) {
    if (!hub.controller.signal.aborted)
      for (const subscription of [...hub.subscriptions]) failSubscription(subscription, error)
  } finally {
    hub.controller.abort()
    hub.wake?.()
    if (taskPollingHubs.get(hub.knowledgeSpaceId) === hub)
      taskPollingHubs.delete(hub.knowledgeSpaceId)
  }
}

export async function* streamProcessingTaskEvents(
  input: StreamProcessingTaskEventsInput,
): AsyncGenerator<ProcessingTaskEvent> {
  if (input.signal?.aborted) return
  const subscription = subscribe(input)
  try {
    while (true) {
      const result = await readSubscriptionEvent(subscription)
      if (result.done) return
      yield result.value
    }
  } finally {
    closeSubscription(subscription)
  }
}
