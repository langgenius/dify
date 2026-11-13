import { describe, expect, it } from 'vite-plus/test'
import { zKnowledgeFsPublicFailureResponse as consoleFailure } from './generated/api/console/knowledge-fs/zod.gen.ts'
import {
  zKnowledgeFsDocumentProcessingTaskResponse,
  zKnowledgeFsPublicFailureResponse as serviceFailure,
} from './generated/api/service/zod.gen.ts'

describe('generated KnowledgeFS document failure contract', () => {
  it.each([
    {
      action: 'retry',
      category: 'dependency',
      code: 'DOCUMENT_SEMANTIC_GROUNDING_FAILED',
      message: 'The model output could not be matched to the original document. Retry processing.',
      retryPolicy: 'manual',
      stage: 'semantic_chunking',
    },
    {
      action: 'reupload',
      category: 'not_found',
      code: 'DOCUMENT_SOURCE_NOT_FOUND',
      message: 'The original file is no longer available. Upload the document again.',
      retryPolicy: 'never',
      stage: 'parsing',
    },
  ])('accepts $code in Console and Service responses', (failure) => {
    expect(consoleFailure.parse(failure)).toMatchObject(failure)
    expect(serviceFailure.parse(failure)).toMatchObject(failure)
  })

  it('preserves the failed operation independently of the resumable checkpoint', () => {
    const task = zKnowledgeFsDocumentProcessingTaskResponse.parse({
      created_at: '2026-10-30T05:00:00Z',
      document_id: 'document-1',
      document_revision: 1,
      error_code: 'DOCUMENT_SEMANTIC_GROUNDING_FAILED',
      failure: {
        action: 'retry',
        category: 'dependency',
        code: 'DOCUMENT_SEMANTIC_GROUNDING_FAILED',
        message: 'Retry processing the document.',
        retryPolicy: 'manual',
        stage: 'semantic_chunking',
      },
      id: 'task-1',
      knowledge_space_id: 'space-1',
      phase: 'outline_summary',
      progress_percent: 20,
      stage: 'parsed',
      state: 'failed',
      updated_at: '2026-10-30T05:01:00Z',
    })

    expect(task.failure?.stage).toBe('semantic_chunking')
    expect(task.stage).toBe('parsed')
    expect(task.progress_percent).toBe(20)
  })
})
