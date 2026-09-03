import type { KnowledgeFsPublicFailureResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { TFunction } from 'i18next'

export type KnowledgeFsTaskFailureMessageKey =
  | 'newKnowledge.taskFailure.access'
  | 'newKnowledge.taskFailure.attemptsExhausted'
  | 'newKnowledge.taskFailure.configuration'
  | 'newKnowledge.taskFailure.conflict'
  | 'newKnowledge.taskFailure.documentProcessing'
  | 'newKnowledge.taskFailure.embeddingDimension'
  | 'newKnowledge.taskFailure.internal'
  | 'newKnowledge.taskFailure.invalid'
  | 'newKnowledge.taskFailure.leaseLost'
  | 'newKnowledge.taskFailure.modelConfiguration'
  | 'newKnowledge.taskFailure.modelFailed'
  | 'newKnowledge.taskFailure.modelResponseInvalid'
  | 'newKnowledge.taskFailure.modelService'
  | 'newKnowledge.taskFailure.modelTimeout'
  | 'newKnowledge.taskFailure.modelUnavailable'
  | 'newKnowledge.taskFailure.parser'
  | 'newKnowledge.taskFailure.parserInputInvalid'
  | 'newKnowledge.taskFailure.parserNotConfigured'
  | 'newKnowledge.taskFailure.parserRateLimited'
  | 'newKnowledge.taskFailure.parserResponseInvalid'
  | 'newKnowledge.taskFailure.parserTimeout'
  | 'newKnowledge.taskFailure.parserUnavailable'
  | 'newKnowledge.taskFailure.parserUnsupportedType'
  | 'newKnowledge.taskFailure.pdfRender'
  | 'newKnowledge.taskFailure.research'
  | 'newKnowledge.taskFailure.source'
  | 'newKnowledge.taskFailure.sourceConfigInvalid'
  | 'newKnowledge.taskFailure.sourceConnection'
  | 'newKnowledge.taskFailure.sourceContentMissing'
  | 'newKnowledge.taskFailure.sourceContentTooLarge'
  | 'newKnowledge.taskFailure.sourceCrawlPageNotFound'
  | 'newKnowledge.taskFailure.sourceCrawlProviderUnavailable'
  | 'newKnowledge.taskFailure.sourceCrawlResultLimit'
  | 'newKnowledge.taskFailure.sourceCredential'
  | 'newKnowledge.taskFailure.sourceDocumentCompilation'
  | 'newKnowledge.taskFailure.sourcePartial'
  | 'newKnowledge.taskFailure.sourceProviderRejected'
  | 'newKnowledge.taskFailure.sourceProviderTimeout'
  | 'newKnowledge.taskFailure.sourceProviderUnavailable'
  | 'newKnowledge.taskFailure.sourceWorkflowTimeout'
  | 'newKnowledge.taskFailure.storageTemporary'
  | 'newKnowledge.taskFailure.temporary'
  | 'newKnowledge.taskFailure.upload'

export type KnowledgeFsTaskFailureStageKey =
  | 'newKnowledge.taskFailure.stage.chunking_indexing'
  | 'newKnowledge.taskFailure.stage.graph_admission'
  | 'newKnowledge.taskFailure.stage.outline_summary'
  | 'newKnowledge.taskFailure.stage.parsing'
  | 'newKnowledge.taskFailure.stage.publication'
  | 'newKnowledge.taskFailure.stage.queued'
  | 'newKnowledge.taskFailure.stage.semantic_enrichment'
  | 'newKnowledge.taskFailure.stage.upload'

const failureMessageKeyByCode = {
  DOCUMENT_COMPILATION_FAILED: 'newKnowledge.taskFailure.documentProcessing',
  DOCUMENT_COMPILATION_LEASE_LOST: 'newKnowledge.taskFailure.leaseLost',
  DOCUMENT_COMPILATION_RETRYABLE: 'newKnowledge.taskFailure.storageTemporary',
  DOCUMENT_DISABLED: 'newKnowledge.taskFailure.conflict',
  DOCUMENT_PARSER_INPUT_INVALID: 'newKnowledge.taskFailure.parserInputInvalid',
  DOCUMENT_PARSER_NOT_CONFIGURED: 'newKnowledge.taskFailure.parserNotConfigured',
  DOCUMENT_PARSER_RATE_LIMITED: 'newKnowledge.taskFailure.parserRateLimited',
  DOCUMENT_PARSER_RESPONSE_INVALID: 'newKnowledge.taskFailure.parserResponseInvalid',
  DOCUMENT_PARSER_TIMEOUT: 'newKnowledge.taskFailure.parserTimeout',
  DOCUMENT_PARSER_UNAVAILABLE: 'newKnowledge.taskFailure.parserUnavailable',
  DOCUMENT_PARSER_UNSUPPORTED_TYPE: 'newKnowledge.taskFailure.parserUnsupportedType',
  DOCUMENT_PDF_RENDER_FAILED: 'newKnowledge.taskFailure.pdfRender',
  EMBEDDING_DIMENSION_INVALID: 'newKnowledge.taskFailure.embeddingDimension',
  EMBEDDING_DIMENSION_UNSUPPORTED: 'newKnowledge.taskFailure.embeddingDimension',
  EXECUTION_ATTEMPTS_EXHAUSTED: 'newKnowledge.taskFailure.attemptsExhausted',
  KNOWLEDGE_FS_ACCESS_DENIED: 'newKnowledge.taskFailure.access',
  KNOWLEDGE_FS_CONFLICT: 'newKnowledge.taskFailure.conflict',
  KNOWLEDGE_FS_INTERNAL_ERROR: 'newKnowledge.taskFailure.internal',
  KNOWLEDGE_FS_INVALID_REQUEST: 'newKnowledge.taskFailure.invalid',
  KNOWLEDGE_FS_NOT_FOUND: 'newKnowledge.taskFailure.access',
  KNOWLEDGE_FS_RATE_LIMITED: 'newKnowledge.taskFailure.temporary',
  KNOWLEDGE_FS_TIMEOUT: 'newKnowledge.taskFailure.temporary',
  KNOWLEDGE_FS_UNAVAILABLE: 'newKnowledge.taskFailure.temporary',
  KNOWLEDGE_SPACE_MANIFEST_NOT_FOUND: 'newKnowledge.taskFailure.modelConfiguration',
  KNOWLEDGE_SPACE_MODEL_CONFIGURATION_REQUIRED: 'newKnowledge.taskFailure.modelConfiguration',
  MODEL_CAPABILITY_MISMATCH: 'newKnowledge.taskFailure.modelConfiguration',
  MODEL_CONFIGURATION_STALE: 'newKnowledge.taskFailure.conflict',
  MODEL_CREDENTIAL_INVALID: 'newKnowledge.taskFailure.modelConfiguration',
  MODEL_CREDENTIAL_VALIDATION_UNAVAILABLE: 'newKnowledge.taskFailure.modelService',
  MODEL_IDENTITY_MISMATCH: 'newKnowledge.taskFailure.modelConfiguration',
  MODEL_PREFLIGHT_CANCELED: 'newKnowledge.taskFailure.modelService',
  MODEL_PREFLIGHT_FAILED: 'newKnowledge.taskFailure.modelService',
  MODEL_PREFLIGHT_TIMEOUT: 'newKnowledge.taskFailure.modelService',
  MODEL_PREFLIGHT_UNAVAILABLE: 'newKnowledge.taskFailure.modelService',
  MODEL_PROFILE_ACTIVATION_INCOMPLETE: 'newKnowledge.taskFailure.modelConfiguration',
  MODEL_PROFILE_ACTIVATION_PERMISSION_REQUIRED: 'newKnowledge.taskFailure.access',
  MODEL_RUNTIME_FAILED: 'newKnowledge.taskFailure.modelFailed',
  MODEL_RUNTIME_RESPONSE_INVALID: 'newKnowledge.taskFailure.modelResponseInvalid',
  MODEL_RUNTIME_TIMEOUT: 'newKnowledge.taskFailure.modelTimeout',
  MODEL_RUNTIME_UNAVAILABLE: 'newKnowledge.taskFailure.modelUnavailable',
  MODEL_SELECTION_NOT_FOUND: 'newKnowledge.taskFailure.modelConfiguration',
  RESEARCH_TASK_CAPABILITY_REVOKED: 'newKnowledge.taskFailure.access',
  RESEARCH_TASK_DISPATCH_DEAD: 'newKnowledge.taskFailure.research',
  RESEARCH_TASK_EXECUTION_ATTEMPTS_EXHAUSTED: 'newKnowledge.taskFailure.research',
  RESEARCH_TASK_FAILED: 'newKnowledge.taskFailure.research',
  RESEARCH_TASK_PERMISSION_SNAPSHOT_INVALID: 'newKnowledge.taskFailure.access',
  RESEARCH_TASK_RUNTIME_SNAPSHOT_INVALID: 'newKnowledge.taskFailure.research',
  RETRIEVAL_DELETION_IN_PROGRESS: 'newKnowledge.taskFailure.conflict',
  RETRIEVAL_EXECUTION_LEASE_LOST: 'newKnowledge.taskFailure.conflict',
  SOURCE_BULK_ACTION_FAILED: 'newKnowledge.taskFailure.source',
  SOURCE_CONNECTION_UNAVAILABLE: 'newKnowledge.taskFailure.sourceConnection',
  SOURCE_CRAWL_PAGE_NOT_FOUND: 'newKnowledge.taskFailure.sourceCrawlPageNotFound',
  SOURCE_CRAWL_PROVIDER_UNAVAILABLE: 'newKnowledge.taskFailure.sourceCrawlProviderUnavailable',
  SOURCE_CRAWL_RESULT_LIMIT_EXCEEDED: 'newKnowledge.taskFailure.sourceCrawlResultLimit',
  SOURCE_CREDENTIAL_CONFIG_INVALID: 'newKnowledge.taskFailure.sourceCredential',
  SOURCE_CREDENTIAL_MUTATION_FAILED: 'newKnowledge.taskFailure.sourceCredential',
  SOURCE_CREDENTIAL_TEST_FAILED: 'newKnowledge.taskFailure.sourceCredential',
  SOURCE_CREDENTIAL_UNAVAILABLE: 'newKnowledge.taskFailure.sourceCredential',
  SOURCE_DOCUMENT_COMPILATION_FAILED: 'newKnowledge.taskFailure.sourceDocumentCompilation',
  SOURCE_DOCUMENT_MATERIALIZATION_FAILED: 'newKnowledge.taskFailure.source',
  SOURCE_DOCUMENT_REPLACEMENT_SAGA_REQUIRED: 'newKnowledge.taskFailure.source',
  SOURCE_IMPORT_PARTIAL_FAILURE: 'newKnowledge.taskFailure.sourcePartial',
  SOURCE_ONLINE_DOCUMENT_CONFIG_INVALID: 'newKnowledge.taskFailure.sourceConfigInvalid',
  SOURCE_ONLINE_DOCUMENT_IMPORT_FAILED: 'newKnowledge.taskFailure.source',
  SOURCE_ONLINE_DOCUMENT_PAGE_FETCH_FAILED: 'newKnowledge.taskFailure.source',
  SOURCE_ONLINE_DOCUMENT_REQUEST_FAILED: 'newKnowledge.taskFailure.source',
  SOURCE_ONLINE_DOCUMENT_UNAVAILABLE: 'newKnowledge.taskFailure.sourceProviderUnavailable',
  SOURCE_ONLINE_DRIVE_CONFIG_INVALID: 'newKnowledge.taskFailure.sourceConfigInvalid',
  SOURCE_ONLINE_DRIVE_FILE_DOWNLOAD_FAILED: 'newKnowledge.taskFailure.source',
  SOURCE_ONLINE_DRIVE_IMPORT_FAILED: 'newKnowledge.taskFailure.source',
  SOURCE_ONLINE_DRIVE_REQUEST_FAILED: 'newKnowledge.taskFailure.source',
  SOURCE_ONLINE_DRIVE_UNAVAILABLE: 'newKnowledge.taskFailure.sourceProviderUnavailable',
  SOURCE_OPERATION_FAILED: 'newKnowledge.taskFailure.source',
  SOURCE_PROVIDER_REJECTED: 'newKnowledge.taskFailure.sourceProviderRejected',
  SOURCE_PROVIDER_TIMEOUT: 'newKnowledge.taskFailure.sourceProviderTimeout',
  SOURCE_PROVIDER_UNAVAILABLE: 'newKnowledge.taskFailure.sourceProviderUnavailable',
  SOURCE_SECRET_INTEGRITY_FAILED: 'newKnowledge.taskFailure.source',
  SOURCE_SECRET_REF_CONFLICT: 'newKnowledge.taskFailure.conflict',
  SOURCE_SYNC_FAILED: 'newKnowledge.taskFailure.source',
  SOURCE_SYNC_SELECTION_MISMATCH: 'newKnowledge.taskFailure.conflict',
  SOURCE_WEBSITE_CRAWL_CONFIG_INVALID: 'newKnowledge.taskFailure.sourceConfigInvalid',
  SOURCE_WEBSITE_CRAWL_FAILED: 'newKnowledge.taskFailure.source',
  SOURCE_WORKFLOW_CONTENT_MISSING: 'newKnowledge.taskFailure.sourceContentMissing',
  SOURCE_WORKFLOW_CONTENT_TOO_LARGE: 'newKnowledge.taskFailure.sourceContentTooLarge',
  SOURCE_WORKFLOW_EXTERNAL_TIMEOUT: 'newKnowledge.taskFailure.sourceWorkflowTimeout',
  SOURCE_WORKFLOW_FAILED: 'newKnowledge.taskFailure.source',
  UPLOAD_INITIALIZATION_FAILED: 'newKnowledge.taskFailure.upload',
  UPLOAD_INTEGRITY_MISMATCH: 'newKnowledge.taskFailure.upload',
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
  if (failure?.action?.startsWith('configure_')) return 'newKnowledge.taskFailure.configuration'
  if (failure?.action === 'reupload') return 'newKnowledge.taskFailure.invalid'

  switch (failure?.category) {
    case 'authorization':
    case 'not_found':
      return 'newKnowledge.taskFailure.access'
    case 'configuration':
      return 'newKnowledge.taskFailure.configuration'
    case 'conflict':
      return 'newKnowledge.taskFailure.conflict'
    case 'dependency':
    case 'rate_limit':
    case 'timeout':
      return 'newKnowledge.taskFailure.temporary'
    case 'validation':
      return 'newKnowledge.taskFailure.invalid'
    case 'canceled':
    case 'internal':
      return 'newKnowledge.taskFailure.internal'
  }

  const code = normalizedLegacyCode ?? ''
  if (/AUTH|DENIED|NOT_FOUND|PERMISSION/u.test(code)) return 'newKnowledge.taskFailure.access'
  if (
    /CREDENTIAL|CONFIG|MODEL_SELECTION|MODEL_CAPABILITY|MODEL_IDENTITY|NOT_CONFIGURED/u.test(code)
  )
    return 'newKnowledge.taskFailure.configuration'
  if (/CONFLICT|STALE|CHANGED/u.test(code)) return 'newKnowledge.taskFailure.conflict'
  if (/INVALID|MISMATCH|TOO_LARGE|UNSUPPORTED/u.test(code))
    return 'newKnowledge.taskFailure.invalid'
  if (/TIMEOUT|RATE_LIMIT|UNAVAILABLE|PROVIDER|PARSER|SOURCE/u.test(code))
    return 'newKnowledge.taskFailure.temporary'
  return 'newKnowledge.taskFailure.internal'
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
  chunking_indexing: 'newKnowledge.taskFailure.stage.chunking_indexing',
  graph_admission: 'newKnowledge.taskFailure.stage.graph_admission',
  nodes_generated: 'newKnowledge.taskFailure.stage.chunking_indexing',
  outline_built: 'newKnowledge.taskFailure.stage.outline_summary',
  outline_summary: 'newKnowledge.taskFailure.stage.outline_summary',
  parse: 'newKnowledge.taskFailure.stage.parsing',
  parsed: 'newKnowledge.taskFailure.stage.parsing',
  parsing: 'newKnowledge.taskFailure.stage.parsing',
  projection_built: 'newKnowledge.taskFailure.stage.chunking_indexing',
  publication: 'newKnowledge.taskFailure.stage.publication',
  published: 'newKnowledge.taskFailure.stage.publication',
  queued: 'newKnowledge.taskFailure.stage.queued',
  semantic_enrichment: 'newKnowledge.taskFailure.stage.semantic_enrichment',
  smoke_eval_passed: 'newKnowledge.taskFailure.stage.publication',
  upload: 'newKnowledge.taskFailure.stage.upload',
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
  t: TFunction<'dataset'>,
): string | undefined {
  const stageKey = knowledgeFsTaskFailureStageKey(failure)
  const reference = knowledgeFsTaskFailureReference(failure)
  const parts = [
    stageKey
      ? t(($) => $['newKnowledge.taskFailure.failedAtStage'], { stage: t(($) => $[stageKey]) })
      : undefined,
    reference
      ? t(($) => $['newKnowledge.taskFailure.reference'], { traceId: reference })
      : undefined,
  ].filter((part): part is string => Boolean(part))
  return parts.length ? parts.join(' · ') : undefined
}
