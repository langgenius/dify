import type { KnowledgeFsPublicFailureResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { TFunction } from 'i18next'

export type KnowledgeFsTaskFailureMessageKey =
  | 'taskFailure.access'
  | 'taskFailure.attemptsExhausted'
  | 'taskFailure.configuration'
  | 'taskFailure.conflict'
  | 'taskFailure.documentProcessing'
  | 'taskFailure.embeddingDimension'
  | 'taskFailure.internal'
  | 'taskFailure.invalid'
  | 'taskFailure.leaseLost'
  | 'taskFailure.modelConfiguration'
  | 'taskFailure.modelFailed'
  | 'taskFailure.modelResponseInvalid'
  | 'taskFailure.modelService'
  | 'taskFailure.modelTimeout'
  | 'taskFailure.modelUnavailable'
  | 'taskFailure.parser'
  | 'taskFailure.parserInputInvalid'
  | 'taskFailure.parserNotConfigured'
  | 'taskFailure.parserRateLimited'
  | 'taskFailure.parserResponseInvalid'
  | 'taskFailure.parserTimeout'
  | 'taskFailure.parserUnavailable'
  | 'taskFailure.parserUnsupportedType'
  | 'taskFailure.pdfRender'
  | 'taskFailure.research'
  | 'taskFailure.source'
  | 'taskFailure.sourceConfigInvalid'
  | 'taskFailure.sourceConnection'
  | 'taskFailure.sourceContentMissing'
  | 'taskFailure.sourceContentTooLarge'
  | 'taskFailure.sourceCrawlPageNotFound'
  | 'taskFailure.sourceCrawlProviderUnavailable'
  | 'taskFailure.sourceCrawlResultLimit'
  | 'taskFailure.sourceCredential'
  | 'taskFailure.sourceDocumentCompilation'
  | 'taskFailure.sourcePartial'
  | 'taskFailure.sourceProviderRejected'
  | 'taskFailure.sourceProviderTimeout'
  | 'taskFailure.sourceProviderUnavailable'
  | 'taskFailure.sourceWorkflowTimeout'
  | 'taskFailure.storageTemporary'
  | 'taskFailure.temporary'
  | 'taskFailure.upload'

export type KnowledgeFsTaskFailureStageKey =
  | 'taskFailure.stage.chunking_indexing'
  | 'taskFailure.stage.graph_admission'
  | 'taskFailure.stage.outline_summary'
  | 'taskFailure.stage.parsing'
  | 'taskFailure.stage.publication'
  | 'taskFailure.stage.queued'
  | 'taskFailure.stage.semantic_enrichment'
  | 'taskFailure.stage.upload'

const failureMessageKeyByCode = {
  DOCUMENT_COMPILATION_FAILED: 'taskFailure.documentProcessing',
  DOCUMENT_COMPILATION_LEASE_LOST: 'taskFailure.leaseLost',
  DOCUMENT_COMPILATION_RETRYABLE: 'taskFailure.storageTemporary',
  DOCUMENT_DISABLED: 'taskFailure.conflict',
  DOCUMENT_PARSER_INPUT_INVALID: 'taskFailure.parserInputInvalid',
  DOCUMENT_PARSER_NOT_CONFIGURED: 'taskFailure.parserNotConfigured',
  DOCUMENT_PARSER_RATE_LIMITED: 'taskFailure.parserRateLimited',
  DOCUMENT_PARSER_RESPONSE_INVALID: 'taskFailure.parserResponseInvalid',
  DOCUMENT_PARSER_TIMEOUT: 'taskFailure.parserTimeout',
  DOCUMENT_PARSER_UNAVAILABLE: 'taskFailure.parserUnavailable',
  DOCUMENT_PARSER_UNSUPPORTED_TYPE: 'taskFailure.parserUnsupportedType',
  DOCUMENT_PDF_RENDER_FAILED: 'taskFailure.pdfRender',
  EMBEDDING_DIMENSION_INVALID: 'taskFailure.embeddingDimension',
  EMBEDDING_DIMENSION_UNSUPPORTED: 'taskFailure.embeddingDimension',
  EXECUTION_ATTEMPTS_EXHAUSTED: 'taskFailure.attemptsExhausted',
  KNOWLEDGE_FS_ACCESS_DENIED: 'taskFailure.access',
  KNOWLEDGE_FS_CONFLICT: 'taskFailure.conflict',
  KNOWLEDGE_FS_INTERNAL_ERROR: 'taskFailure.internal',
  KNOWLEDGE_FS_INVALID_REQUEST: 'taskFailure.invalid',
  KNOWLEDGE_FS_NOT_FOUND: 'taskFailure.access',
  KNOWLEDGE_FS_RATE_LIMITED: 'taskFailure.temporary',
  KNOWLEDGE_FS_TIMEOUT: 'taskFailure.temporary',
  KNOWLEDGE_FS_UNAVAILABLE: 'taskFailure.temporary',
  KNOWLEDGE_SPACE_MANIFEST_NOT_FOUND: 'taskFailure.modelConfiguration',
  KNOWLEDGE_SPACE_MODEL_CONFIGURATION_REQUIRED: 'taskFailure.modelConfiguration',
  MODEL_CAPABILITY_MISMATCH: 'taskFailure.modelConfiguration',
  MODEL_CONFIGURATION_STALE: 'taskFailure.conflict',
  MODEL_CREDENTIAL_INVALID: 'taskFailure.modelConfiguration',
  MODEL_CREDENTIAL_VALIDATION_UNAVAILABLE: 'taskFailure.modelService',
  MODEL_IDENTITY_MISMATCH: 'taskFailure.modelConfiguration',
  MODEL_PREFLIGHT_CANCELED: 'taskFailure.modelService',
  MODEL_PREFLIGHT_FAILED: 'taskFailure.modelService',
  MODEL_PREFLIGHT_TIMEOUT: 'taskFailure.modelService',
  MODEL_PREFLIGHT_UNAVAILABLE: 'taskFailure.modelService',
  MODEL_PROFILE_ACTIVATION_INCOMPLETE: 'taskFailure.modelConfiguration',
  MODEL_PROFILE_ACTIVATION_PERMISSION_REQUIRED: 'taskFailure.access',
  MODEL_RUNTIME_FAILED: 'taskFailure.modelFailed',
  MODEL_RUNTIME_RESPONSE_INVALID: 'taskFailure.modelResponseInvalid',
  MODEL_RUNTIME_TIMEOUT: 'taskFailure.modelTimeout',
  MODEL_RUNTIME_UNAVAILABLE: 'taskFailure.modelUnavailable',
  MODEL_SELECTION_NOT_FOUND: 'taskFailure.modelConfiguration',
  RESEARCH_TASK_CAPABILITY_REVOKED: 'taskFailure.access',
  RESEARCH_TASK_DISPATCH_DEAD: 'taskFailure.research',
  RESEARCH_TASK_EXECUTION_ATTEMPTS_EXHAUSTED: 'taskFailure.research',
  RESEARCH_TASK_FAILED: 'taskFailure.research',
  RESEARCH_TASK_PERMISSION_SNAPSHOT_INVALID: 'taskFailure.access',
  RESEARCH_TASK_RUNTIME_SNAPSHOT_INVALID: 'taskFailure.research',
  RETRIEVAL_DELETION_IN_PROGRESS: 'taskFailure.conflict',
  RETRIEVAL_EXECUTION_LEASE_LOST: 'taskFailure.conflict',
  SOURCE_BULK_ACTION_FAILED: 'taskFailure.source',
  SOURCE_CONNECTION_UNAVAILABLE: 'taskFailure.sourceConnection',
  SOURCE_CRAWL_PAGE_NOT_FOUND: 'taskFailure.sourceCrawlPageNotFound',
  SOURCE_CRAWL_PROVIDER_UNAVAILABLE: 'taskFailure.sourceCrawlProviderUnavailable',
  SOURCE_CRAWL_RESULT_LIMIT_EXCEEDED: 'taskFailure.sourceCrawlResultLimit',
  SOURCE_CREDENTIAL_CONFIG_INVALID: 'taskFailure.sourceCredential',
  SOURCE_CREDENTIAL_MUTATION_FAILED: 'taskFailure.sourceCredential',
  SOURCE_CREDENTIAL_TEST_FAILED: 'taskFailure.sourceCredential',
  SOURCE_CREDENTIAL_UNAVAILABLE: 'taskFailure.sourceCredential',
  SOURCE_DOCUMENT_COMPILATION_FAILED: 'taskFailure.sourceDocumentCompilation',
  SOURCE_DOCUMENT_MATERIALIZATION_FAILED: 'taskFailure.source',
  SOURCE_DOCUMENT_REPLACEMENT_SAGA_REQUIRED: 'taskFailure.source',
  SOURCE_IMPORT_PARTIAL_FAILURE: 'taskFailure.sourcePartial',
  SOURCE_ONLINE_DOCUMENT_CONFIG_INVALID: 'taskFailure.sourceConfigInvalid',
  SOURCE_ONLINE_DOCUMENT_IMPORT_FAILED: 'taskFailure.source',
  SOURCE_ONLINE_DOCUMENT_PAGE_FETCH_FAILED: 'taskFailure.source',
  SOURCE_ONLINE_DOCUMENT_REQUEST_FAILED: 'taskFailure.source',
  SOURCE_ONLINE_DOCUMENT_UNAVAILABLE: 'taskFailure.sourceProviderUnavailable',
  SOURCE_ONLINE_DRIVE_CONFIG_INVALID: 'taskFailure.sourceConfigInvalid',
  SOURCE_ONLINE_DRIVE_FILE_DOWNLOAD_FAILED: 'taskFailure.source',
  SOURCE_ONLINE_DRIVE_IMPORT_FAILED: 'taskFailure.source',
  SOURCE_ONLINE_DRIVE_REQUEST_FAILED: 'taskFailure.source',
  SOURCE_ONLINE_DRIVE_UNAVAILABLE: 'taskFailure.sourceProviderUnavailable',
  SOURCE_OPERATION_FAILED: 'taskFailure.source',
  SOURCE_PROVIDER_REJECTED: 'taskFailure.sourceProviderRejected',
  SOURCE_PROVIDER_TIMEOUT: 'taskFailure.sourceProviderTimeout',
  SOURCE_PROVIDER_UNAVAILABLE: 'taskFailure.sourceProviderUnavailable',
  SOURCE_SECRET_INTEGRITY_FAILED: 'taskFailure.source',
  SOURCE_SECRET_REF_CONFLICT: 'taskFailure.conflict',
  SOURCE_SYNC_FAILED: 'taskFailure.source',
  SOURCE_SYNC_SELECTION_MISMATCH: 'taskFailure.conflict',
  SOURCE_WEBSITE_CRAWL_CONFIG_INVALID: 'taskFailure.sourceConfigInvalid',
  SOURCE_WEBSITE_CRAWL_FAILED: 'taskFailure.source',
  SOURCE_WORKFLOW_CONTENT_MISSING: 'taskFailure.sourceContentMissing',
  SOURCE_WORKFLOW_CONTENT_TOO_LARGE: 'taskFailure.sourceContentTooLarge',
  SOURCE_WORKFLOW_EXTERNAL_TIMEOUT: 'taskFailure.sourceWorkflowTimeout',
  SOURCE_WORKFLOW_FAILED: 'taskFailure.source',
  UPLOAD_INITIALIZATION_FAILED: 'taskFailure.upload',
  UPLOAD_INTEGRITY_MISMATCH: 'taskFailure.upload',
} satisfies Record<KnowledgeFsPublicFailureResponse['code'], KnowledgeFsTaskFailureMessageKey>

export function knowledgeFsTaskFailureMessageKey(
  failure: KnowledgeFsPublicFailureResponse | undefined,
  legacyCode?: string,
): KnowledgeFsTaskFailureMessageKey | undefined {
  if (!failure && !legacyCode) return
  const normalizedLegacyCode = legacyCode?.toUpperCase()
  if (normalizedLegacyCode && normalizedLegacyCode in failureMessageKeyByCode)
    return failureMessageKeyByCode[normalizedLegacyCode as keyof typeof failureMessageKeyByCode]
  if (failure) {
    const messageKey = failureMessageKeyByCode[failure.code]
    if (messageKey) return messageKey
  }
  if (failure?.action?.startsWith('configure_')) return 'taskFailure.configuration'
  if (failure?.action === 'reupload') return 'taskFailure.invalid'

  switch (failure?.category) {
    case 'authorization':
    case 'not_found':
      return 'taskFailure.access'
    case 'configuration':
      return 'taskFailure.configuration'
    case 'conflict':
      return 'taskFailure.conflict'
    case 'dependency':
    case 'rate_limit':
    case 'timeout':
      return 'taskFailure.temporary'
    case 'validation':
      return 'taskFailure.invalid'
    case 'canceled':
    case 'internal':
      return 'taskFailure.internal'
  }

  const code = normalizedLegacyCode ?? ''
  if (/AUTH|DENIED|NOT_FOUND|PERMISSION/u.test(code)) return 'taskFailure.access'
  if (
    /CREDENTIAL|CONFIG|MODEL_SELECTION|MODEL_CAPABILITY|MODEL_IDENTITY|NOT_CONFIGURED/u.test(code)
  )
    return 'taskFailure.configuration'
  if (/CONFLICT|STALE|CHANGED/u.test(code)) return 'taskFailure.conflict'
  if (/INVALID|MISMATCH|TOO_LARGE|UNSUPPORTED/u.test(code)) return 'taskFailure.invalid'
  if (/TIMEOUT|RATE_LIMIT|UNAVAILABLE|PROVIDER|PARSER|SOURCE/u.test(code))
    return 'taskFailure.temporary'
  return 'taskFailure.internal'
}

export function knowledgeFsTaskRecoveryPath(
  failure: KnowledgeFsPublicFailureResponse | undefined,
  knowledgeSpaceId: string,
): string | undefined {
  if (failure?.action === 'configure_model') return `/datasets/new/${knowledgeSpaceId}/settings`
  if (failure?.action === 'configure_source') return `/datasets/new/${knowledgeSpaceId}/sources`
  if (failure?.action === 'reupload') return `/datasets/new/${knowledgeSpaceId}/documents?upload=1`
}

const failureStageKeyByStage: Readonly<Record<string, KnowledgeFsTaskFailureStageKey>> = {
  chunking_indexing: 'taskFailure.stage.chunking_indexing',
  graph_admission: 'taskFailure.stage.graph_admission',
  nodes_generated: 'taskFailure.stage.chunking_indexing',
  outline_built: 'taskFailure.stage.outline_summary',
  outline_summary: 'taskFailure.stage.outline_summary',
  parse: 'taskFailure.stage.parsing',
  parsed: 'taskFailure.stage.parsing',
  parsing: 'taskFailure.stage.parsing',
  projection_built: 'taskFailure.stage.chunking_indexing',
  publication: 'taskFailure.stage.publication',
  published: 'taskFailure.stage.publication',
  queued: 'taskFailure.stage.queued',
  semantic_enrichment: 'taskFailure.stage.semantic_enrichment',
  smoke_eval_passed: 'taskFailure.stage.publication',
  upload: 'taskFailure.stage.upload',
}

/**
 * Human-readable pipeline stage for a failure, when the stage is one of the document pipeline
 * phases. Source workflow checkpoints have no user-facing label and yield nothing.
 */
export function knowledgeFsTaskFailureStageKey(
  failure: KnowledgeFsPublicFailureResponse | undefined,
): KnowledgeFsTaskFailureStageKey | undefined {
  const stage = failure?.stage?.trim().toLowerCase()
  return stage ? failureStageKeyByStage[stage] : undefined
}

/** Support reference to quote when asking an administrator for help. */
export function knowledgeFsTaskFailureReference(
  failure: KnowledgeFsPublicFailureResponse | undefined,
): string | undefined {
  return failure?.traceId?.trim() || undefined
}

/**
 * "Failed at <stage> · Reference: <id>" — tells the user where processing stopped and gives a
 * support reference to quote, without ever exposing provider text.
 */
export function knowledgeFsTaskFailureDetail(
  failure: KnowledgeFsPublicFailureResponse | undefined,
  t: TFunction<'knowledgeSpace'>,
): string | undefined {
  const stageKey = knowledgeFsTaskFailureStageKey(failure)
  const reference = knowledgeFsTaskFailureReference(failure)
  const parts = [
    stageKey
      ? t(($) => $['taskFailure.failedAtStage'], { stage: t(($) => $[stageKey]) })
      : undefined,
    reference ? t(($) => $['taskFailure.reference'], { traceId: reference }) : undefined,
  ].filter((part): part is string => Boolean(part))
  return parts.length ? parts.join(' · ') : undefined
}
