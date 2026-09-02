import type {
  KnowledgeFsQueryImageResponse,
  KnowledgeFsResearchTaskResponse,
  KnowledgeFsTraceResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'

export type RetrievalTestMode = 'deep' | 'fast' | 'research'

export function normalizedRetrievalTestMode(mode?: string): RetrievalTestMode {
  if (mode === 'deep' || mode === 'research') return mode
  return 'fast'
}

export type RetrievalEvidence = {
  availability?: 'available' | 'unavailable'
  chunkId?: string
  documentAssetId?: string
  documentId?: string
  documentName?: string
  documentRevision?: number
  id: string
  images: string[]
  page?: number
  revision?: string
  score?: number
  text: string
  title: string
  unavailableReason?: string
}

/**
 * A query image a retrieval run was asked with. `previewUrl` is an object URL for an image
 * attached in this session or a short-lived signed URL for a persisted one; it is absent when
 * the uploaded file no longer exists.
 */
export type RetrievalQueryImage = {
  name: string
  previewUrl?: string
  sizeBytes: number
  uploadFileId: string
}

export function retrievalQueryImages(
  images: readonly KnowledgeFsQueryImageResponse[] | null | undefined,
): RetrievalQueryImage[] {
  return (images ?? []).map((image) => ({
    name: image.name || image.upload_file_id,
    ...(image.preview_url ? { previewUrl: image.preview_url } : {}),
    sizeBytes: image.byte_size ?? 0,
    uploadFileId: image.upload_file_id,
  }))
}

export type RetrievalTestRecord =
  | {
      createdAt: number
      id: string
      kind: 'local'
      mode: Exclude<RetrievalTestMode, 'research'>
      query: string
      queryImages?: RetrievalQueryImage[]
      durationMs?: number
      resultCount?: number
      status: 'completed' | 'failed' | 'running'
    }
  | {
      createdAt: number
      durationMs?: number
      id: string
      kind: 'trace'
      mode: RetrievalTestMode
      query: string
      queryImages?: RetrievalQueryImage[]
      resultCount?: number
      status: 'completed' | 'failed'
    }
  | {
      createdAt: number
      id: string
      kind: 'research'
      mode: 'research'
      query: string
      queryImages?: RetrievalQueryImage[]
      stage: KnowledgeFsResearchTaskResponse['stage']
      status: 'canceled' | 'completed' | 'failed' | 'running'
      updatedAt: number
    }

const activeResearchStages = new Set<KnowledgeFsResearchTaskResponse['stage']>([
  'analyzing',
  'generating',
  'planning',
  'queued',
  'retrieving',
])

function objectValue(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function firstString(...values: unknown[]) {
  return values.find((value): value is string => typeof value === 'string' && value.trim() !== '')
}

function firstNumber(...values: unknown[]) {
  return values.find(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  )
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (typeof item === 'string') return item
      const record = objectValue(item)
      return record ? firstString(record.url, record.source_url, record.sourceUrl) : undefined
    })
    .filter((item): item is string => Boolean(item))
}

function evidenceFromValue(
  value: unknown,
  index: number,
  context: string,
): RetrievalEvidence | undefined {
  const record = objectValue(value)
  if (!record) return undefined
  const metadata = objectValue(record.metadata) ?? {}
  const document = objectValue(record.document) ?? objectValue(metadata.document) ?? {}
  const citation = Array.isArray(record.citations) ? (objectValue(record.citations[0]) ?? {}) : {}
  const availabilityValue = firstString(record.availability, metadata.availability)
  const availability = availabilityValue === 'unavailable' ? 'unavailable' : 'available'
  const text = firstString(
    record.text,
    record.content,
    record.chunk_text,
    record.chunkText,
    record.snippet,
    metadata.text,
    metadata.content,
    metadata.chunk_text,
    metadata.chunkText,
  )
  const score = firstNumber(
    record.score,
    record.final_score,
    record.finalScore,
    record.relevance_score,
    record.relevanceScore,
    metadata.score,
    metadata.final_score,
    metadata.finalScore,
  )
  const documentName = firstString(
    record.filename,
    record.document_name,
    record.documentName,
    document.filename,
    document.name,
    metadata.filename,
    metadata.document_name,
    metadata.documentName,
  )
  const documentId = firstString(
    record.logical_document_id,
    record.logicalDocumentId,
    metadata.logical_document_id,
    metadata.logicalDocumentId,
    record.resource_type !== 'node' && record.resourceType !== 'node'
      ? record.target_id
      : undefined,
    record.resource_type !== 'node' && record.resourceType !== 'node' ? record.targetId : undefined,
  )
  const documentAssetId = firstString(
    record.document_asset_id,
    record.documentAssetId,
    metadata.document_asset_id,
    metadata.documentAssetId,
    metadata.document_id,
    metadata.documentId,
    citation.documentAssetId,
    citation.document_asset_id,
  )
  const documentRevision = firstNumber(
    record.document_revision,
    record.documentRevision,
    record.document_version,
    record.documentVersion,
    metadata.document_revision,
    metadata.documentRevision,
    metadata.document_version,
    metadata.documentVersion,
    citation.document_version,
    citation.documentVersion,
  )
  const page = firstNumber(
    record.page,
    record.page_number,
    record.pageNumber,
    metadata.page,
    metadata.page_number,
    metadata.pageNumber,
  )
  const title = firstString(
    record.chunk_name,
    record.chunkName,
    record.title,
    metadata.chunk_name,
    metadata.chunkName,
    metadata.title,
    record.name,
    context.includes('chunk') ? record.name : undefined,
  )
  const resourceType = firstString(record.resource_type, record.resourceType)
  const chunkId = firstString(
    record.chunk_id,
    record.chunkId,
    record.node_id,
    record.nodeId,
    metadata.chunk_id,
    metadata.chunkId,
    resourceType === 'node' ? record.target_id : undefined,
    resourceType === 'node' ? record.targetId : undefined,
  )
  const hasEvidenceSignal = Boolean(
    score !== undefined ||
    documentName ||
    documentId ||
    documentAssetId ||
    page !== undefined ||
    record.kind === 'resource' ||
    typeof record.resource_type === 'string' ||
    /chunk|evidence|result|record|source|partial/.test(context),
  )
  if ((!text && availability !== 'unavailable') || !hasEvidenceSignal) return undefined
  const id =
    firstString(record.id, chunkId, record.target_id, record.targetId, metadata.id) ??
    `${context}-${index}-${(text ?? 'unavailable').slice(0, 24)}`
  const images = [
    ...stringArray(record.images),
    ...stringArray(record.files),
    ...stringArray(record.attachments),
    ...stringArray(metadata.images),
    ...stringArray(metadata.files),
  ]

  return {
    availability,
    chunkId,
    documentAssetId,
    documentId,
    documentName,
    documentRevision,
    id,
    images: [...new Set(images)],
    page,
    revision: firstString(
      record.revision,
      record.revision_label,
      record.revisionLabel,
      metadata.revision,
      metadata.revision_label,
      metadata.revisionLabel,
      typeof metadata.documentVersion === 'number' ? String(metadata.documentVersion) : undefined,
      typeof citation.documentVersion === 'number'
        ? `Revision ${citation.documentVersion}`
        : undefined,
      typeof citation.document_version === 'number'
        ? `Revision ${citation.document_version}`
        : undefined,
    ),
    score,
    text: text ?? '',
    title: title ?? `Chunk ${index + 1}`,
    unavailableReason: firstString(
      record.unavailable_reason,
      record.unavailableReason,
      metadata.unavailable_reason,
      metadata.unavailableReason,
    ),
  }
}

const evidenceContainerKeys = new Set([
  'data',
  'evidence',
  'evidenceBundle',
  'evidence_bundle',
  'items',
  'partials',
  'records',
  'results',
  'sources',
  'chunks',
])

export function extractRetrievalEvidence(value: unknown) {
  const evidence: RetrievalEvidence[] = []
  const visited = new Set<unknown>()

  const visit = (candidate: unknown, context = 'root') => {
    if (!candidate || visited.has(candidate)) return
    if (typeof candidate === 'object') visited.add(candidate)
    if (Array.isArray(candidate)) {
      candidate.forEach((item, index) => {
        const normalized = evidenceFromValue(item, index, context)
        if (normalized) evidence.push(normalized)
        visit(item, context)
      })
      return
    }
    const record = objectValue(candidate)
    if (!record) return
    if (context !== 'root') {
      const normalized = evidenceFromValue(record, evidence.length, context)
      if (normalized) evidence.push(normalized)
    }
    const traverseAll = /chunk|evidence|result|source|partial/.test(context)
    for (const [key, nested] of Object.entries(record)) {
      if (evidenceContainerKeys.has(key)) visit(nested, key.toLowerCase())
      else if (traverseAll && nested && typeof nested === 'object') visit(nested, context)
    }
  }

  visit(value)
  const deduped = new Map<string, RetrievalEvidence>()
  for (const item of evidence) {
    const key = item.id || `${item.documentName ?? ''}:${item.text}`
    if (!deduped.has(key)) deduped.set(key, item)
  }
  return [...deduped.values()]
}

export function extractTraceId(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const id = extractTraceId(item)
      if (id) return id
    }
    return undefined
  }
  const record = objectValue(value)
  if (!record) return undefined
  const direct = firstString(record.trace_id, record.traceId)
  if (direct) return direct
  for (const nested of Object.values(record)) {
    const id = extractTraceId(nested)
    if (id) return id
  }
}

export function extractStreamError(value: unknown): string | undefined {
  const record = objectValue(value)
  if (!record) return undefined
  const event = firstString(record.event, record.type, record.status)?.toLowerCase()
  if (event && /error|fail/.test(event))
    return firstString(record.message, record.error, objectValue(record.error)?.message)
  return undefined
}

export function researchTaskStatus(
  stage: KnowledgeFsResearchTaskResponse['stage'],
): Extract<RetrievalTestRecord, { kind: 'research' }>['status'] {
  if (stage === 'completed') return 'completed'
  if (stage === 'failed') return 'failed'
  if (stage === 'canceled') return 'canceled'
  return 'running'
}

function epochMilliseconds(value: number) {
  return value < 10_000_000_000 ? value * 1000 : value
}

export function retrievalTestRecords(
  traces: KnowledgeFsTraceResponse[],
  researchTasks: KnowledgeFsResearchTaskResponse[],
): RetrievalTestRecord[] {
  return [
    ...traces
      .filter((trace) => trace.mode !== 'research')
      .map((trace): RetrievalTestRecord => ({
        createdAt: new Date(trace.created_at).getTime(),
        ...(trace.duration_ms !== null && trace.duration_ms !== undefined
          ? { durationMs: trace.duration_ms }
          : {}),
        id: trace.id,
        kind: 'trace',
        mode: trace.mode === 'research' || trace.mode === 'deep' ? trace.mode : 'fast',
        query: trace.query,
        ...(trace.query_images?.length
          ? { queryImages: retrievalQueryImages(trace.query_images) }
          : {}),
        ...(trace.result_count !== null && trace.result_count !== undefined
          ? { resultCount: trace.result_count }
          : {}),
        status: trace.completed ? 'completed' : 'failed',
      })),
    ...researchTasks.map((task): RetrievalTestRecord => ({
      createdAt: epochMilliseconds(task.created_at),
      id: task.id,
      kind: 'research',
      mode: 'research',
      query: task.query,
      ...(task.query_images?.length
        ? { queryImages: retrievalQueryImages(task.query_images) }
        : {}),
      stage: task.stage,
      status: researchTaskStatus(task.stage),
      updatedAt: epochMilliseconds(task.updated_at),
    })),
  ].sort((left, right) => right.createdAt - left.createdAt)
}

export function researchTaskIsActive(task?: KnowledgeFsResearchTaskResponse) {
  return task ? activeResearchStages.has(task.stage) : false
}

export function researchTaskCanRetry(task?: KnowledgeFsResearchTaskResponse) {
  if (task?.stage !== 'failed') return false
  if (!task.failure) return true
  return task.failure.retryPolicy === 'automatic' || task.failure.retryPolicy === 'manual'
}

export function shouldRefreshResearchPartials(
  previousTask: KnowledgeFsResearchTaskResponse | undefined,
  task: KnowledgeFsResearchTaskResponse | undefined,
) {
  return Boolean(
    task?.stage === 'completed' &&
    previousTask?.id === task.id &&
    researchTaskIsActive(previousTask),
  )
}

function formatTimeUnit(value: number, unit: 'millisecond' | 'minute' | 'second', locale: string) {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1,
    style: 'unit',
    unit,
    unitDisplay: 'narrow',
  }).format(value)
}

export function formatDuration(milliseconds: number, locale = 'en-US') {
  const seconds = Math.max(0, Math.round(milliseconds / 1000))
  if (seconds < 60) return formatTimeUnit(seconds, 'second', locale)
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  const formattedMinutes = formatTimeUnit(minutes, 'minute', locale)
  return remainingSeconds
    ? `${formattedMinutes} ${formatTimeUnit(remainingSeconds, 'second', locale)}`
    : formattedMinutes
}

export function formatStageDuration(milliseconds: number, locale = 'en-US') {
  const duration = Math.max(0, milliseconds)
  if (duration > 0 && duration < 1_000)
    return formatTimeUnit(Math.max(1, Math.round(duration)), 'millisecond', locale)
  return formatDuration(duration, locale)
}

export function formatRetrievalDuration(milliseconds: number, locale = 'en-US') {
  const duration = Math.max(0, milliseconds)
  if (duration < 1_000) return formatTimeUnit(Math.round(duration), 'millisecond', locale)
  const seconds = duration / 1_000
  const roundedSeconds = seconds < 10 ? Math.round(seconds * 10) / 10 : Math.round(seconds)
  return formatTimeUnit(roundedSeconds, 'second', locale)
}
