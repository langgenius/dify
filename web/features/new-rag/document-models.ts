import type {
  KnowledgeFsBackgroundTaskListResponse,
  KnowledgeFsBackgroundTaskResponse,
  KnowledgeFsDocumentChunkListResponse,
  KnowledgeFsDocumentChunkResponse,
  KnowledgeFsDocumentRevisionListResponse,
  KnowledgeFsDocumentRevisionResponse,
  KnowledgeFsLogicalDocumentListResponse,
  KnowledgeFsLogicalDocumentResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'

export type LogicalDocumentRevision = {
  activatedAt?: string
  contentHash: string
  createdAt: string
  documentAssetId: string
  documentAssetVersion: number
  documentId: string
  knowledgeSpaceId: string
  mimeType: string
  revision: number
  sizeBytes: number
  state: 'candidate' | 'active' | 'superseded' | 'failed'
} | null

export type LogicalDocument = {
  active: LogicalDocumentRevision
  activeRevision?: number
  createdAt: string
  id: string
  knowledgeSpaceId: string
  providerItemId?: string
  rowVersion: number
  sourceId?: string
  status: 'pending' | 'ready' | 'failed' | 'deleting'
  title: string
  updatedAt: string
  userMetadata: Record<string, unknown>
}

type LogicalDocumentList = {
  items: LogicalDocument[]
  nextCursor?: string
}

type DocumentRevisionList = {
  items: Array<NonNullable<LogicalDocumentRevision>>
  nextCursor?: string
}

export type DocumentRevisionChunk = {
  createdAt: string
  documentId: string
  documentRevision: number
  enabled: boolean
  id: string
  knowledgeSpaceId: string
  ordinal: number
  parentChunkId?: string
  text: string
  tokenCount: number
  userMetadata: Record<string, unknown>
}

type DocumentChunkList = {
  items: DocumentRevisionChunk[]
  nextCursor?: string
}

export type DocumentProcessingTask = {
  canCancel?: boolean
  canRetry?: boolean
  completedAt?: string
  createdAt: string
  documentId: string
  documentRevision: number
  errorCode?: string
  errorMessage?: string
  id: string
  knowledgeSpaceId: string
  operation?: KnowledgeFsBackgroundTaskResponse['operation']
  progressPercent: number
  retryAt?: string
  stage:
    | 'queued'
    | 'parsed'
    | 'outline_built'
    | 'nodes_generated'
    | 'projection_built'
    | 'smoke_eval_passed'
    | 'published'
  state:
    | 'dispatch_pending'
    | 'queued'
    | 'running'
    | 'retry_wait'
    | 'succeeded'
    | 'failed'
    | 'canceled'
    | 'superseded'
  taskKind?: KnowledgeFsBackgroundTaskResponse['task_kind']
  updatedAt: string
}

type DocumentProcessingTaskList = {
  items: DocumentProcessingTask[]
  nextCursor?: string
}

export type DocumentProcessingTaskEvent =
  | {
      data: {
        progressPercent: number
        stage: DocumentProcessingTask['stage']
        state: DocumentProcessingTask['state']
        updatedAt: string
      }
      event: 'progress'
    }
  | {
      data: {
        errorCode?: string
        state: 'succeeded' | 'failed' | 'canceled' | 'superseded'
      }
      event: 'terminal'
    }

function revisionFromApi(
  revision: KnowledgeFsDocumentRevisionResponse,
): NonNullable<LogicalDocumentRevision> {
  return {
    activatedAt: revision.activated_at ?? undefined,
    contentHash: revision.content_hash,
    createdAt: revision.created_at,
    documentAssetId: revision.document_asset_id,
    documentAssetVersion: revision.document_asset_version,
    documentId: revision.document_id,
    knowledgeSpaceId: revision.knowledge_space_id,
    mimeType: revision.mime_type,
    revision: revision.revision,
    sizeBytes: revision.size_bytes,
    state: revision.state,
  }
}

export function logicalDocumentFromApi(
  document: KnowledgeFsLogicalDocumentResponse,
): LogicalDocument {
  const displayName = document.user_metadata.displayName
  return {
    active: document.active ? revisionFromApi(document.active) : null,
    activeRevision: document.active_revision ?? undefined,
    createdAt: document.created_at,
    id: document.id,
    knowledgeSpaceId: document.knowledge_space_id,
    providerItemId: document.provider_item_id ?? undefined,
    rowVersion: document.row_version,
    sourceId: document.source_id ?? undefined,
    status: document.status,
    title:
      typeof displayName === 'string' && displayName.trim() ? displayName.trim() : document.title,
    updatedAt: document.updated_at,
    userMetadata: document.user_metadata,
  }
}

export function logicalDocumentListFromApi(
  response: KnowledgeFsLogicalDocumentListResponse,
): LogicalDocumentList {
  return {
    items: response.data.map(logicalDocumentFromApi),
    nextCursor: response.next_cursor ?? undefined,
  }
}

export function documentRevisionListFromApi(
  response: KnowledgeFsDocumentRevisionListResponse,
): DocumentRevisionList {
  return {
    items: response.data.map(revisionFromApi),
    nextCursor: response.next_cursor ?? undefined,
  }
}

function documentChunkFromApi(chunk: KnowledgeFsDocumentChunkResponse): DocumentRevisionChunk {
  return {
    createdAt: chunk.created_at,
    documentId: chunk.document_id,
    documentRevision: chunk.document_revision,
    enabled: chunk.enabled,
    id: chunk.id,
    knowledgeSpaceId: chunk.knowledge_space_id,
    ordinal: chunk.ordinal,
    parentChunkId: chunk.parent_chunk_id ?? undefined,
    text: chunk.text,
    tokenCount: chunk.token_count,
    userMetadata: chunk.user_metadata,
  }
}

export function documentChunkListFromApi(
  response: KnowledgeFsDocumentChunkListResponse,
): DocumentChunkList {
  return {
    items: response.data.map(documentChunkFromApi),
    nextCursor: response.next_cursor ?? undefined,
  }
}

function taskStage(task: KnowledgeFsBackgroundTaskResponse): DocumentProcessingTask['stage'] {
  if (task.state === 'completed') return 'published'
  if (task.progress_percent >= 90) return 'smoke_eval_passed'
  if (task.progress_percent >= 75) return 'projection_built'
  if (task.progress_percent >= 50) return 'nodes_generated'
  if (task.progress_percent >= 25) return 'parsed'
  return 'queued'
}

export function documentTaskFromApi(
  task: KnowledgeFsBackgroundTaskResponse,
): DocumentProcessingTask | undefined {
  if (!task.document_id) return undefined
  return {
    canCancel: task.can_cancel,
    canRetry: task.can_retry,
    completedAt: task.completed_at ?? undefined,
    createdAt: task.created_at,
    documentId: task.document_id,
    documentRevision: task.document_revision ?? 1,
    errorCode: task.error_code ?? undefined,
    errorMessage: task.error_message ?? undefined,
    id: task.id,
    knowledgeSpaceId: task.knowledge_space_id,
    operation: task.operation,
    progressPercent: task.progress_percent,
    stage: taskStage(task),
    state:
      task.state === 'completed'
        ? 'succeeded'
        : task.state === 'canceled'
          ? 'canceled'
          : task.state,
    taskKind: task.task_kind,
    updatedAt: task.updated_at,
  }
}

export function documentTaskListFromApi(
  response: KnowledgeFsBackgroundTaskListResponse,
): DocumentProcessingTaskList {
  return {
    items: response.data.flatMap((task) => {
      const mapped = documentTaskFromApi(task)
      return mapped ? [mapped] : []
    }),
    nextCursor: response.next_cursor ?? undefined,
  }
}
