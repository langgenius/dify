import type { KnowledgeFsPublicFailureResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import {
  knowledgeFsRequestFailureMessageKey,
  knowledgeFsTaskFailureDetail,
  knowledgeFsTaskFailureMessageKey,
  knowledgeFsTaskRecoveryPath,
} from '../knowledge-fs-task-error'

const failure = (
  overrides: Partial<KnowledgeFsPublicFailureResponse> = {},
): KnowledgeFsPublicFailureResponse => ({
  category: 'internal',
  code: 'KNOWLEDGE_FS_INTERNAL_ERROR',
  message: 'Safe server fallback',
  retryPolicy: 'manual',
  ...overrides,
})

describe('KnowledgeFS task error presentation', () => {
  it.each([
    ['DOCUMENT_COUNT_QUOTA_EXCEEDED', 'taskFailure.documentCountQuotaExceeded'],
    ['DOCUMENT_COUNT_QUOTA_UNAVAILABLE', 'taskFailure.documentCountQuotaUnavailable'],
    ['VECTOR_SPACE_QUOTA_EXCEEDED', 'taskFailure.vectorSpaceQuotaExceeded'],
    ['VECTOR_SPACE_QUOTA_UNAVAILABLE', 'taskFailure.vectorSpaceQuotaUnavailable'],
  ] as const)('presents %s for task failures and legacy error codes', (code, key) => {
    const quotaFailure = failure({ code })
    expect(knowledgeFsTaskFailureMessageKey(quotaFailure)).toBe(key)
    expect(knowledgeFsTaskFailureMessageKey(undefined, code)).toBe(key)
    expect(knowledgeFsTaskRecoveryPath(quotaFailure, 'space-1')).toBeUndefined()
  })

  it('distinguishes exhausted token recovery from invalid model output', () => {
    expect(
      knowledgeFsTaskFailureMessageKey(
        failure({
          category: 'dependency',
          code: 'MODEL_RUNTIME_OUTPUT_LIMIT',
        }),
      ),
    ).toBe('taskFailure.modelOutputLimit')
    const contextFailure = failure({
      category: 'configuration',
      code: 'MODEL_RUNTIME_CONTEXT_LIMIT',
      action: 'configure_model',
      retryPolicy: 'after_configuration',
    })
    expect(knowledgeFsTaskFailureMessageKey(contextFailure)).toBe('taskFailure.modelContextLimit')
    expect(knowledgeFsTaskRecoveryPath(contextFailure, 'space-1')).toBe(
      '/datasets/new/space-1/settings',
    )
  })
  it('routes model configuration failures to settings', () => {
    const modelFailure = failure({
      action: 'configure_model',
      category: 'configuration',
      code: 'MODEL_SELECTION_NOT_FOUND',
      retryPolicy: 'after_configuration',
    })

    expect(knowledgeFsTaskFailureMessageKey(modelFailure)).toBe('taskFailure.modelConfiguration')
    expect(knowledgeFsTaskRecoveryPath(modelFailure, 'space-1')).toBe(
      '/datasets/new/space-1/settings',
    )
    expect(
      knowledgeFsTaskRecoveryPath(
        failure({ action: 'configure_parser', category: 'configuration' }),
        'space-1',
      ),
    ).toBeUndefined()
  })

  it('uses localized model-service guidance instead of provider messages', () => {
    expect(
      knowledgeFsTaskFailureMessageKey(
        failure({ category: 'timeout', code: 'MODEL_RUNTIME_TIMEOUT' }),
      ),
    ).toBe('taskFailure.modelTimeout')
    expect(
      knowledgeFsTaskFailureMessageKey(
        failure({ category: 'dependency', code: 'MODEL_RUNTIME_RESPONSE_INVALID' }),
      ),
    ).toBe('taskFailure.modelResponseInvalid')
    expect(
      knowledgeFsTaskFailureMessageKey(
        failure({ category: 'configuration', code: 'EMBEDDING_DIMENSION_INVALID' }),
      ),
    ).toBe('taskFailure.embeddingDimension')
    expect(
      knowledgeFsTaskFailureMessageKey(
        failure({ category: 'authorization', code: 'KNOWLEDGE_FS_ACCESS_DENIED' }),
      ),
    ).toBe('taskFailure.access')
  })

  it('keeps permanent model configuration failures distinct from transient validation outages', () => {
    expect(
      knowledgeFsTaskFailureMessageKey(
        failure({
          category: 'configuration',
          code: 'MODEL_CREDENTIAL_INVALID',
          retryPolicy: 'after_configuration',
        }),
      ),
    ).toBe('taskFailure.modelConfiguration')
    expect(
      knowledgeFsTaskFailureMessageKey(
        failure({
          category: 'dependency',
          code: 'MODEL_CREDENTIAL_VALIDATION_UNAVAILABLE',
          retryPolicy: 'automatic',
        }),
      ),
    ).toBe('taskFailure.modelService')
  })

  it('distinguishes document, parser, source, and upload failures', () => {
    expect(knowledgeFsTaskFailureMessageKey(failure({ code: 'DOCUMENT_COMPILATION_FAILED' }))).toBe(
      'taskFailure.documentProcessing',
    )
    expect(knowledgeFsTaskFailureMessageKey(failure({ code: 'DOCUMENT_PARSER_UNAVAILABLE' }))).toBe(
      'taskFailure.parserUnavailable',
    )
    expect(
      knowledgeFsTaskFailureMessageKey(failure({ code: 'DOCUMENT_PARSER_UNSUPPORTED_TYPE' })),
    ).toBe('taskFailure.parserUnsupportedType')
    expect(knowledgeFsTaskFailureMessageKey(failure({ code: 'SOURCE_SYNC_FAILED' }))).toBe(
      'taskFailure.source',
    )
    expect(
      knowledgeFsTaskFailureMessageKey(failure({ code: 'SOURCE_DOCUMENT_COMPILATION_FAILED' })),
    ).toBe('taskFailure.sourceDocumentCompilation')
    expect(knowledgeFsTaskFailureMessageKey(failure({ code: 'SOURCE_CRAWL_PAGE_NOT_FOUND' }))).toBe(
      'taskFailure.sourceCrawlPageNotFound',
    )
    expect(knowledgeFsTaskFailureMessageKey(failure({ code: 'SOURCE_PROVIDER_TIMEOUT' }))).toBe(
      'taskFailure.sourceProviderTimeout',
    )
    expect(knowledgeFsTaskFailureMessageKey(failure({ code: 'UPLOAD_INTEGRITY_MISMATCH' }))).toBe(
      'taskFailure.upload',
    )
  })

  it('provides safe compatibility behavior for legacy error codes', () => {
    expect(knowledgeFsTaskFailureMessageKey(undefined, 'SOURCE_OPERATION_FAILED')).toBe(
      'taskFailure.source',
    )
    expect(knowledgeFsTaskFailureMessageKey(undefined, 'PARSER_FAILED')).toBe(
      'taskFailure.temporary',
    )
    expect(knowledgeFsTaskFailureMessageKey(undefined, 'UNREGISTERED_FAILURE')).toBe(
      'taskFailure.internal',
    )
  })

  it('tells the user where processing stopped and what reference to quote', () => {
    const t = ((
      selector: (keys: Record<string, string>) => string,
      params?: Record<string, string>,
    ) => {
      const key = selector(new Proxy({}, { get: (_target, name) => String(name) }))
      return params ? `${key}:${JSON.stringify(params)}` : key
    }) as never

    expect(
      knowledgeFsTaskFailureDetail(
        failure({
          code: 'MODEL_RUNTIME_RESPONSE_INVALID',
          stage: 'chunking_indexing',
          traceId: 'task-1',
        }),
        t,
      ),
    ).toBe(
      'taskFailure.failedAtStage:{"stage":"taskFailure.stage.chunking_indexing"} · taskFailure.reference:{"traceId":"task-1"}',
    )
    // Source workflow checkpoints have no user-facing label: only the reference remains.
    expect(
      knowledgeFsTaskFailureDetail(failure({ stage: 'materialized', traceId: 'run-1' }), t),
    ).toBe('taskFailure.reference:{"traceId":"run-1"}')
    expect(knowledgeFsTaskFailureDetail(failure(), t)).toBeUndefined()
    expect(knowledgeFsTaskFailureDetail(undefined, t)).toBeUndefined()
  })

  it('routes re-upload and source configuration actions to bounded product paths', () => {
    expect(
      knowledgeFsTaskRecoveryPath(
        failure({ action: 'reupload', category: 'validation' }),
        'space-1',
      ),
    ).toBe('/datasets/new/space-1/documents?upload=1')
    expect(
      knowledgeFsTaskRecoveryPath(
        failure({ action: 'configure_source', category: 'configuration' }),
        'space-1',
      ),
    ).toBe('/datasets/new/space-1/sources')
  })
})

describe('KnowledgeFS request failure presentation', () => {
  it.each([
    [413, 'DOCUMENT_COUNT_QUOTA_EXCEEDED', 'taskFailure.documentCountQuotaExceeded'],
    [503, 'DOCUMENT_COUNT_QUOTA_UNAVAILABLE', 'taskFailure.documentCountQuotaUnavailable'],
    [413, 'VECTOR_SPACE_QUOTA_EXCEEDED', 'taskFailure.vectorSpaceQuotaExceeded'],
    [503, 'VECTOR_SPACE_QUOTA_UNAVAILABLE', 'taskFailure.vectorSpaceQuotaUnavailable'],
  ] as const)('localizes HTTP %s %s without consuming the response', async (status, code, key) => {
    const response = Response.json(
      {
        failure: {
          category: status === 413 ? 'configuration' : 'dependency',
          code,
          message: 'Private billing service diagnostic',
          retryPolicy: status === 413 ? 'after_configuration' : 'manual',
        },
      },
      { status },
    )
    expect(await knowledgeFsRequestFailureMessageKey(response)).toBe(key)
    expect(response.bodyUsed).toBe(false)
  })

  it.each([
    new Error('Private diagnostic'),
    new Response('invalid JSON', { status: 503 }),
    Response.json({ message: 'Private diagnostic' }, { status: 413 }),
    Response.json({ failure: { code: 'DOCUMENT_COUNT_QUOTA_EXCEEDED' } }, { status: 413 }),
    Response.json(
      {
        failure: {
          code: 'UNKNOWN',
          category: 'dependency',
          retryPolicy: 'manual',
          message: 'Private',
        },
      },
      { status: 503 },
    ),
  ])('lets the caller use its existing fallback for malformed failures', async (error) => {
    expect(await knowledgeFsRequestFailureMessageKey(error)).toBeUndefined()
  })
})
