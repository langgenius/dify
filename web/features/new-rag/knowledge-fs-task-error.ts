import type { KnowledgeFsPublicFailureResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'

export type KnowledgeFsTaskFailureMessageKey =
  | 'newKnowledge.taskFailure.access'
  | 'newKnowledge.taskFailure.configuration'
  | 'newKnowledge.taskFailure.conflict'
  | 'newKnowledge.taskFailure.documentProcessing'
  | 'newKnowledge.taskFailure.internal'
  | 'newKnowledge.taskFailure.invalid'
  | 'newKnowledge.taskFailure.modelConfiguration'
  | 'newKnowledge.taskFailure.modelService'
  | 'newKnowledge.taskFailure.parser'
  | 'newKnowledge.taskFailure.research'
  | 'newKnowledge.taskFailure.source'
  | 'newKnowledge.taskFailure.temporary'
  | 'newKnowledge.taskFailure.upload'

const failureMessageKeyByCode = {
  DOCUMENT_COMPILATION_FAILED: 'newKnowledge.taskFailure.documentProcessing',
  DOCUMENT_COMPILATION_RETRYABLE: 'newKnowledge.taskFailure.documentProcessing',
  DOCUMENT_DISABLED: 'newKnowledge.taskFailure.conflict',
  DOCUMENT_PARSER_INPUT_INVALID: 'newKnowledge.taskFailure.parser',
  DOCUMENT_PARSER_NOT_CONFIGURED: 'newKnowledge.taskFailure.parser',
  DOCUMENT_PARSER_RATE_LIMITED: 'newKnowledge.taskFailure.parser',
  DOCUMENT_PARSER_RESPONSE_INVALID: 'newKnowledge.taskFailure.parser',
  DOCUMENT_PARSER_UNAVAILABLE: 'newKnowledge.taskFailure.parser',
  EMBEDDING_DIMENSION_INVALID: 'newKnowledge.taskFailure.modelConfiguration',
  EMBEDDING_DIMENSION_UNSUPPORTED: 'newKnowledge.taskFailure.modelConfiguration',
  EXECUTION_ATTEMPTS_EXHAUSTED: 'newKnowledge.taskFailure.documentProcessing',
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
  MODEL_RUNTIME_FAILED: 'newKnowledge.taskFailure.modelService',
  MODEL_RUNTIME_TIMEOUT: 'newKnowledge.taskFailure.modelService',
  MODEL_RUNTIME_UNAVAILABLE: 'newKnowledge.taskFailure.modelService',
  MODEL_SELECTION_NOT_FOUND: 'newKnowledge.taskFailure.modelConfiguration',
  RESEARCH_TASK_CAPABILITY_REVOKED: 'newKnowledge.taskFailure.access',
  RESEARCH_TASK_DISPATCH_DEAD: 'newKnowledge.taskFailure.research',
  RESEARCH_TASK_EXECUTION_ATTEMPTS_EXHAUSTED: 'newKnowledge.taskFailure.research',
  RESEARCH_TASK_FAILED: 'newKnowledge.taskFailure.research',
  RESEARCH_TASK_PERMISSION_SNAPSHOT_INVALID: 'newKnowledge.taskFailure.access',
  RESEARCH_TASK_RUNTIME_SNAPSHOT_INVALID: 'newKnowledge.taskFailure.research',
  SOURCE_BULK_ACTION_FAILED: 'newKnowledge.taskFailure.source',
  SOURCE_CREDENTIAL_CONFIG_INVALID: 'newKnowledge.taskFailure.source',
  SOURCE_CREDENTIAL_MUTATION_FAILED: 'newKnowledge.taskFailure.source',
  SOURCE_CREDENTIAL_TEST_FAILED: 'newKnowledge.taskFailure.source',
  SOURCE_CREDENTIAL_UNAVAILABLE: 'newKnowledge.taskFailure.source',
  SOURCE_DOCUMENT_COMPILATION_FAILED: 'newKnowledge.taskFailure.source',
  SOURCE_DOCUMENT_MATERIALIZATION_FAILED: 'newKnowledge.taskFailure.source',
  SOURCE_DOCUMENT_REPLACEMENT_SAGA_REQUIRED: 'newKnowledge.taskFailure.source',
  SOURCE_ONLINE_DOCUMENT_CONFIG_INVALID: 'newKnowledge.taskFailure.source',
  SOURCE_ONLINE_DOCUMENT_IMPORT_FAILED: 'newKnowledge.taskFailure.source',
  SOURCE_ONLINE_DOCUMENT_PAGE_FETCH_FAILED: 'newKnowledge.taskFailure.source',
  SOURCE_ONLINE_DOCUMENT_REQUEST_FAILED: 'newKnowledge.taskFailure.source',
  SOURCE_ONLINE_DRIVE_CONFIG_INVALID: 'newKnowledge.taskFailure.source',
  SOURCE_ONLINE_DRIVE_FILE_DOWNLOAD_FAILED: 'newKnowledge.taskFailure.source',
  SOURCE_ONLINE_DRIVE_IMPORT_FAILED: 'newKnowledge.taskFailure.source',
  SOURCE_ONLINE_DRIVE_REQUEST_FAILED: 'newKnowledge.taskFailure.source',
  SOURCE_OPERATION_FAILED: 'newKnowledge.taskFailure.source',
  SOURCE_SECRET_INTEGRITY_FAILED: 'newKnowledge.taskFailure.source',
  SOURCE_SECRET_REF_CONFLICT: 'newKnowledge.taskFailure.conflict',
  SOURCE_SYNC_FAILED: 'newKnowledge.taskFailure.source',
  SOURCE_WEBSITE_CRAWL_CONFIG_INVALID: 'newKnowledge.taskFailure.source',
  SOURCE_WEBSITE_CRAWL_FAILED: 'newKnowledge.taskFailure.source',
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
