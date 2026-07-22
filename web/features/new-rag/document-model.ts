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
])

function rfc3339Parts(value: string) {
  const match = /^(.*:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (!match) return
  const epochSecond = Date.parse(`${match[1]}${match[3]}`)
  if (Number.isNaN(epochSecond)) return
  return { epochSecond, fraction: match[2] ?? '' }
}

export function taskVersionIsAfter(candidate: string, baseline: string) {
  const candidateParts = rfc3339Parts(candidate)
  const baselineParts = rfc3339Parts(baseline)
  if (candidateParts && baselineParts) {
    if (candidateParts.epochSecond !== baselineParts.epochSecond)
      return candidateParts.epochSecond > baselineParts.epochSecond
    const precision = Math.max(candidateParts.fraction.length, baselineParts.fraction.length)
    return (
      candidateParts.fraction.padEnd(precision, '0') > baselineParts.fraction.padEnd(precision, '0')
    )
  }
  return candidate.localeCompare(baseline) > 0
}

export function sourceName(document: LogicalDocument) {
  const value = document.userMetadata.sourceName
  return typeof value === 'string' && value.trim() ? value : undefined
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
        (taskVersionIsAfter(task.updatedAt, current.updatedAt) ||
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
  return task.state === 'failed'
}
