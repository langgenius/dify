import type { KnowledgeFsPublicFailureResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import {
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
  it('routes model configuration failures to settings', () => {
    const modelFailure = failure({
      action: 'configure_model',
      category: 'configuration',
      code: 'MODEL_SELECTION_NOT_FOUND',
      retryPolicy: 'after_configuration',
    })

    expect(knowledgeFsTaskFailureMessageKey(modelFailure)).toBe(
      'newKnowledge.taskFailure.modelConfiguration',
    )
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
    ).toBe('newKnowledge.taskFailure.modelService')
    expect(
      knowledgeFsTaskFailureMessageKey(
        failure({ category: 'authorization', code: 'KNOWLEDGE_FS_ACCESS_DENIED' }),
      ),
    ).toBe('newKnowledge.taskFailure.access')
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
    ).toBe('newKnowledge.taskFailure.modelConfiguration')
    expect(
      knowledgeFsTaskFailureMessageKey(
        failure({
          category: 'dependency',
          code: 'MODEL_CREDENTIAL_VALIDATION_UNAVAILABLE',
          retryPolicy: 'automatic',
        }),
      ),
    ).toBe('newKnowledge.taskFailure.modelService')
  })

  it('distinguishes document, parser, source, and upload failures', () => {
    expect(knowledgeFsTaskFailureMessageKey(failure({ code: 'DOCUMENT_COMPILATION_FAILED' }))).toBe(
      'newKnowledge.taskFailure.documentProcessing',
    )
    expect(knowledgeFsTaskFailureMessageKey(failure({ code: 'DOCUMENT_PARSER_UNAVAILABLE' }))).toBe(
      'newKnowledge.taskFailure.parser',
    )
    expect(knowledgeFsTaskFailureMessageKey(failure({ code: 'SOURCE_SYNC_FAILED' }))).toBe(
      'newKnowledge.taskFailure.source',
    )
    expect(knowledgeFsTaskFailureMessageKey(failure({ code: 'UPLOAD_INTEGRITY_MISMATCH' }))).toBe(
      'newKnowledge.taskFailure.upload',
    )
  })

  it('provides safe compatibility behavior for legacy error codes', () => {
    expect(knowledgeFsTaskFailureMessageKey(undefined, 'SOURCE_OPERATION_FAILED')).toBe(
      'newKnowledge.taskFailure.source',
    )
    expect(knowledgeFsTaskFailureMessageKey(undefined, 'PARSER_FAILED')).toBe(
      'newKnowledge.taskFailure.temporary',
    )
    expect(knowledgeFsTaskFailureMessageKey(undefined, 'UNREGISTERED_FAILURE')).toBe(
      'newKnowledge.taskFailure.internal',
    )
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
