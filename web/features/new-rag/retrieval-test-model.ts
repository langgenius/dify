import type {
  KnowledgeFsResearchTaskResponse,
  KnowledgeFsTraceResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'

export type RetrievalTestMode = 'deep' | 'fast' | 'research'

export type RetrievalEvidence = {
  chunkId?: string
  documentId?: string
  documentName?: string
  id: string
  images: string[]
  page?: number
  revision?: string
  score?: number
  text: string
  title: string
}

export type RetrievalTestRecord =
  | {
      createdAt: number
      id: string
      kind: 'local'
      mode: Exclude<RetrievalTestMode, 'research'>
      query: string
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
      resultCount?: number
      status: 'completed' | 'failed'
    }
  | {
      createdAt: number
      id: string
      kind: 'research'
      mode: 'research'
      query: string
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
    record.document_id,
    record.documentId,
    document.id,
    metadata.document_id,
    metadata.documentId,
    citation.documentAssetId,
    citation.document_asset_id,
    record.target_id,
    record.targetId,
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
    page !== undefined ||
    record.kind === 'resource' ||
    typeof record.resource_type === 'string' ||
    /chunk|evidence|result|record|source|partial/.test(context),
  )
  if (!text || !hasEvidenceSignal) return undefined
  const id =
    firstString(record.id, chunkId, record.target_id, record.targetId, metadata.id) ??
    `${context}-${index}-${text.slice(0, 24)}`
  const images = [
    ...stringArray(record.images),
    ...stringArray(record.files),
    ...stringArray(record.attachments),
    ...stringArray(metadata.images),
    ...stringArray(metadata.files),
  ]

  return {
    chunkId,
    documentId,
    documentName,
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
    text,
    title: title ?? `Chunk ${index + 1}`,
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
      stage: task.stage,
      status: researchTaskStatus(task.stage),
      updatedAt: epochMilliseconds(task.updated_at),
    })),
  ].sort((left, right) => right.createdAt - left.createdAt)
}

export function researchTaskIsActive(task?: KnowledgeFsResearchTaskResponse) {
  return task ? activeResearchStages.has(task.stage) : false
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

export function formatDuration(milliseconds: number) {
  const seconds = Math.max(0, Math.round(milliseconds / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return remainingSeconds ? `${minutes}min ${remainingSeconds}s` : `${minutes}min`
}

export function formatRetrievalDuration(milliseconds: number) {
  const duration = Math.max(0, milliseconds)
  if (duration < 1_000) return `${Math.round(duration)} ms`
  const seconds = duration / 1_000
  const roundedSeconds = seconds < 10 ? Math.round(seconds * 10) / 10 : Math.round(seconds)
  return `${roundedSeconds} s`
}
