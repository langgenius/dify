import type {
  DocumentProcessingTask,
  LogicalDocument,
} from '@dify/contracts/knowledge-fs/types.gen'

export type DocumentDisplayStatus = 'ready' | 'queued' | 'processing' | 'failed' | 'disabled'

export const ACTIVE_TASK_STATES = new Set<DocumentProcessingTask['state']>([
  'dispatch_pending',
  'queued',
  'running',
  'retry_wait',
])

export const ATTENTION_TASK_STATES = new Set<DocumentProcessingTask['state']>([
  ...ACTIVE_TASK_STATES,
  'failed',
  'canceled',
])

export function sourceName(document: LogicalDocument) {
  const value = document.userMetadata.sourceName
  if (typeof value === 'string' && value.trim()) return value
  return document.sourceId
}

export function documentDisabled(document: LogicalDocument, sourceDisabled = false) {
  return document.status === 'deleting' || sourceDisabled
}

export function newestTaskByDocument(tasks: DocumentProcessingTask[]) {
  const result = new Map<string, DocumentProcessingTask>()
  for (const task of tasks) {
    const current = result.get(task.documentId)
    if (
      !current ||
      task.documentRevision > current.documentRevision ||
      (task.documentRevision === current.documentRevision &&
        (task.updatedAt > current.updatedAt ||
          (task.updatedAt === current.updatedAt && task.id > current.id)))
    )
      result.set(task.documentId, task)
  }
  return result
}

export function documentDisplayStatus(
  document: LogicalDocument,
  task?: DocumentProcessingTask,
  sourceDisabled = false,
): DocumentDisplayStatus {
  if (documentDisabled(document, sourceDisabled)) return 'disabled'

  const activeRevision = document.activeRevision ?? document.active?.revision ?? 0
  const taskRepresentsLatestRevision = task && task.documentRevision >= activeRevision
  if (taskRepresentsLatestRevision) {
    if (task.state === 'running') return 'processing'
    if (task.state === 'dispatch_pending' || task.state === 'queued' || task.state === 'retry_wait')
      return 'queued'
    if (task.state === 'failed') return 'failed'
    if (task.state === 'canceled' && !document.active) return 'failed'
  }

  if (document.status === 'failed') return 'failed'
  if (document.status === 'pending') return 'queued'
  return 'ready'
}

export function taskNeedsAttention(task: DocumentProcessingTask) {
  return ATTENTION_TASK_STATES.has(task.state)
}

export function taskIsActive(task: DocumentProcessingTask) {
  return ACTIVE_TASK_STATES.has(task.state)
}

export function taskCanRetry(task: DocumentProcessingTask) {
  return task.state === 'failed' || task.state === 'canceled'
}
