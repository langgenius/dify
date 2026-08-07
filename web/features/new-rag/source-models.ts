import type {
  KnowledgeFsCrawlPreviewPageListResponse,
  KnowledgeFsSourceConnectionListResponse,
  KnowledgeFsSourceConnectionResponse,
  KnowledgeFsSourceProviderListResponse,
  KnowledgeFsSourceResponse,
  KnowledgeFsSourceSyncPolicyPayload,
  KnowledgeFsSourceSyncPolicyResponse,
  KnowledgeFsSourceWorkflowResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'

export type Source = {
  connectionId?: string
  createdAt: string
  credentialConfigured?: boolean
  id: string
  knowledgeSpaceId: string
  lastSyncedAt?: string
  metadata: Record<string, unknown>
  name: string
  permissionScope?: string[]
  status: 'active' | 'syncing' | 'error' | 'disabled'
  syncWorkflow?: SourceWorkflowRun
  syncPolicy?: SourceSyncPolicy
  type: 'upload' | 'object-storage' | 'connector' | 'web'
  updatedAt: string
  uri: string
  version?: number
}

export type SourceProvider = {
  authKinds: Array<'api-key' | 'endpoint' | 'oauth2'>
  available: boolean
  capabilities: Array<'website-crawl' | 'online-document' | 'online-drive'>
  configuration: Array<{
    description?: string
    format?: 'password' | 'uri'
    name: string
    required: boolean
    secret: boolean
    type: 'boolean' | 'integer' | 'string'
  }>
  displayName: string
  id: string
  unavailableReason?: string
}

export type SourceConnection = {
  authKind: 'api-key' | 'endpoint' | 'oauth2'
  configuration: Record<string, boolean | number | string>
  createdAt: string
  errorCode?: string
  expiresAt?: string
  id: string
  knowledgeSpaceId: string
  name: string
  providerId: string
  scopes: string[]
  status: 'provisioning' | 'active' | 'expired' | 'error' | 'revoked'
  updatedAt: string
  version: number
}

export type SourceWorkflowRun = {
  canceledAt?: string
  checkpoint: string
  completedAt?: string
  createdAt: string
  cursor?: string
  executionAttempts: number
  id: string
  knowledgeSpaceId: string
  kind: string
  lastErrorCode?: string
  maxExecutionAttempts: number
  progressCompleted: number
  progressFailed: number
  progressSkipped: number
  progressTotal?: number
  sourceId?: string
  state: string
  updatedAt: string
}

export type CrawlPreviewPage = {
  description?: string
  etag?: string
  pageId: string
  sourceUrl: string
  title?: string
}

export type CrawlPreviewPageList = {
  items: CrawlPreviewPage[]
  nextCursor?: string
}

export type SourceSyncPolicy = {
  createdAt: string
  customIntervalSeconds?: number
  enabled: boolean
  expectedSourceVersion: number
  id: string
  knowledgeSpaceId: string
  mode: 'provider' | 'manual' | 'interval' | 'custom'
  nextRunAt?: string
  revision: number
  sourceId: string
  updatedAt: string
}

export type SourceSyncPolicyBody = KnowledgeFsSourceSyncPolicyPayload

const SOURCE_WORKFLOW_SUCCESS_STATES = new Set([
  'complete',
  'completed',
  'success',
  'succeeded',
  'zero_results',
])
const SOURCE_WORKFLOW_FAILURE_STATES = new Set([
  'canceled',
  'cancelled',
  'error',
  'exhausted',
  'failed',
  'timed_out',
  'timeout',
])

export function sourceWorkflowStatus(state: string): Source['status'] {
  const normalized = state.trim().toLowerCase().replaceAll('-', '_').replaceAll(' ', '_')
  if (SOURCE_WORKFLOW_FAILURE_STATES.has(normalized)) return 'error'
  if (SOURCE_WORKFLOW_SUCCESS_STATES.has(normalized)) return 'active'
  return 'syncing'
}

export function sourceStatusWithSyncWorkflow(
  status: Source['status'],
  syncWorkflow?: SourceWorkflowRun,
): Source['status'] {
  if (status === 'disabled' || !syncWorkflow) return status
  return sourceWorkflowStatus(syncWorkflow.state)
}

export function sourceFromApi(source: KnowledgeFsSourceResponse): Source {
  const syncWorkflow = source.sync_workflow
    ? sourceWorkflowFromApi(source.sync_workflow)
    : undefined
  return {
    connectionId: source.connection_id ?? undefined,
    createdAt: source.created_at,
    credentialConfigured: source.credential_configured ?? undefined,
    id: source.id,
    knowledgeSpaceId: source.knowledge_space_id,
    lastSyncedAt: source.last_synced_at ?? undefined,
    metadata: source.metadata,
    name: source.name,
    permissionScope: source.permission_scope,
    status: sourceStatusWithSyncWorkflow(source.status, syncWorkflow),
    syncWorkflow,
    syncPolicy: source.sync_policy ? sourceSyncPolicyFromApi(source.sync_policy) : undefined,
    type: source.type,
    updatedAt: source.updated_at,
    uri: source.uri,
    version: source.version,
  }
}

export function sourceProviderListFromApi(
  response: KnowledgeFsSourceProviderListResponse,
): SourceProvider[] {
  return response.data.map((provider) => ({
    authKinds: provider.auth_kinds,
    available: provider.available,
    capabilities: provider.capabilities,
    configuration: provider.configuration.map((field) => ({
      description: field.description ?? undefined,
      format: field.format ?? undefined,
      name: field.name,
      required: field.required,
      secret: field.secret,
      type: field.type,
    })),
    displayName: provider.display_name,
    id: provider.id,
    unavailableReason: provider.unavailable_reason ?? undefined,
  }))
}

export function sourceConnectionFromApi(
  connection: KnowledgeFsSourceConnectionResponse,
): SourceConnection {
  return {
    authKind: connection.auth_kind,
    configuration: connection.configuration,
    createdAt: connection.created_at,
    errorCode: connection.error_code ?? undefined,
    expiresAt: connection.expires_at ?? undefined,
    id: connection.id,
    knowledgeSpaceId: connection.knowledge_space_id,
    name: connection.name,
    providerId: connection.provider_id,
    scopes: connection.scopes,
    status: connection.status,
    updatedAt: connection.updated_at,
    version: connection.version,
  }
}

export function sourceConnectionListFromApi(response: KnowledgeFsSourceConnectionListResponse): {
  items: SourceConnection[]
  nextCursor?: string
} {
  return {
    items: response.data.map(sourceConnectionFromApi),
    nextCursor: response.next_cursor ?? undefined,
  }
}

export function sourceWorkflowFromApi(
  workflow: KnowledgeFsSourceWorkflowResponse,
): SourceWorkflowRun {
  return {
    canceledAt: workflow.canceled_at ?? undefined,
    checkpoint: workflow.checkpoint,
    completedAt: workflow.completed_at ?? undefined,
    createdAt: workflow.created_at,
    cursor: workflow.cursor ?? undefined,
    executionAttempts: workflow.execution_attempts,
    id: workflow.id,
    knowledgeSpaceId: workflow.knowledge_space_id,
    kind: workflow.kind,
    lastErrorCode: workflow.last_error_code ?? undefined,
    maxExecutionAttempts: workflow.max_execution_attempts,
    progressCompleted: workflow.progress_completed,
    progressFailed: workflow.progress_failed,
    progressSkipped: workflow.progress_skipped,
    progressTotal: workflow.progress_total ?? undefined,
    sourceId: workflow.source_id ?? undefined,
    state: workflow.state,
    updatedAt: workflow.updated_at,
  }
}

export function crawlPreviewPageListFromApi(
  response: KnowledgeFsCrawlPreviewPageListResponse,
): CrawlPreviewPageList {
  return {
    items: response.data.map((page) => ({
      description: page.description ?? undefined,
      etag: page.etag ?? undefined,
      pageId: page.page_id,
      sourceUrl: page.source_url,
      title: page.title ?? undefined,
    })),
    nextCursor: response.next_cursor ?? undefined,
  }
}

export function sourceSyncPolicyFromApi(
  policy: KnowledgeFsSourceSyncPolicyResponse,
): SourceSyncPolicy {
  return {
    createdAt: policy.created_at,
    customIntervalSeconds: policy.custom_interval_seconds ?? undefined,
    enabled: policy.enabled,
    expectedSourceVersion: policy.expected_source_version,
    id: policy.id,
    knowledgeSpaceId: policy.knowledge_space_id,
    mode: policy.mode,
    nextRunAt: policy.next_run_at ?? undefined,
    revision: policy.revision,
    sourceId: policy.source_id,
    updatedAt: policy.updated_at,
  }
}
