import { describe, expect, it } from 'vite-plus/test'
import {
  zDatasetConcurrentUpdateError as zConsoleDatasetConcurrentUpdateError,
  zDatasetDetailResponse as zConsoleDatasetDetailResponse,
  zDocumentDetailResponse as zConsoleDocumentDetailResponse,
  zDocumentResponse as zConsoleDocumentResponse,
  zDocumentSourceConflictError as zConsoleDocumentSourceConflictError,
  zDocumentStatusResponse as zConsoleDocumentStatusResponse,
  zHitTestingResponse as zConsoleHitTestingResponse,
  zKnowledgeIndexUnavailableError as zConsoleKnowledgeIndexUnavailableError,
} from './generated/api/console/datasets/zod.gen.ts'
import { zFileResponse } from './generated/api/console/files/zod.gen.ts'
import {
  zCompletionRequestPayloadWithUser,
  zDatasetConcurrentUpdateError,
  zDatasetDetailResponse,
  zDocumentDetailResponse,
  zDocumentResponse,
  zDocumentSourceConflictError,
  zDocumentStatusResponse,
  zExternalKnowledgeFailedError,
  zHitTestingResponse,
  zKnowledgeIndexUnavailableError,
  zParameters,
  zPostChatMessagesResponse,
  zPostCompletionMessagesResponse,
  zPostDatasetsByDatasetIdPipelineRunResponse,
  zPostDatasetsByDatasetIdPipelineRunBody,
  zPostWorkflowsByWorkflowIdRunResponse,
  zPostWorkflowsRunResponse,
} from './generated/api/service/zod.gen.ts'

describe('generated Service API schemas', () => {
  it.each(['indexing', 'failed'])(
    'preserves the unavailable-index recovery reason %s on both API surfaces',
    (reason) => {
      const failure = {
        code: 'knowledge_index_unavailable',
        status: 503,
        message: 'Index unavailable',
        details: { reason },
      }
      for (const schema of [
        zKnowledgeIndexUnavailableError,
        zConsoleKnowledgeIndexUnavailableError,
      ]) {
        expect(schema.parse(failure)).toEqual(failure)
        expect(schema.safeParse({ ...failure, details: { reason: 'ready' } }).success).toBe(false)
      }
    },
  )

  it('preserves concurrent dataset updates as retryable conflicts on both API surfaces', () => {
    const failure = { code: 'dataset_concurrent_update', status: 409, message: 'Retry the update' }

    for (const schema of [zDatasetConcurrentUpdateError, zConsoleDatasetConcurrentUpdateError]) {
      expect(schema.parse(failure)).toEqual(failure)
      expect(schema.safeParse({ ...failure, status: 500 }).success).toBe(false)
    }
  })

  it('preserves file lifecycle conflicts on both API surfaces', () => {
    const failure = {
      code: 'document_source_conflict',
      status: 409,
      message: 'Source is being deleted',
    }

    for (const schema of [zDocumentSourceConflictError, zConsoleDocumentSourceConflictError]) {
      expect(schema.parse(failure)).toEqual(failure)
      expect(schema.safeParse({ ...failure, status: 400 }).success).toBe(false)
    }
  })

  it('exposes dataset vector rebuild state as an optional nullable enum', () => {
    for (const schema of [zDatasetDetailResponse, zConsoleDatasetDetailResponse]) {
      for (const value of ['indexing', 'completed', 'error', null, undefined])
        expect(schema.shape.vector_indexing_status.safeParse(value).success).toBe(true)
      expect(schema.shape.vector_indexing_status.safeParse('failed').success).toBe(false)

      for (const value of ['Provider unavailable', null, undefined])
        expect(schema.shape.vector_indexing_error.safeParse(value).success).toBe(true)
      expect(schema.shape.vector_indexing_error.safeParse({ message: 'failed' }).success).toBe(
        false,
      )
    }
  })

  it('exposes document indexing intent state on detail and list records', () => {
    for (const schema of [
      zDocumentDetailResponse,
      zDocumentResponse,
      zDocumentStatusResponse,
      zConsoleDocumentDetailResponse,
      zConsoleDocumentResponse,
      zConsoleDocumentStatusResponse,
    ]) {
      for (const value of ['pending', 'completed', 'failed', null, undefined])
        expect(schema.shape.indexing_state.safeParse(value).success).toBe(true)
      expect(schema.shape.indexing_state.safeParse('indexing').success).toBe(false)

      for (const action of ['retry', 'enable', 'disable', 'archive', null, undefined])
        expect(schema.shape.indexing_retry_action.safeParse(action).success).toBe(true)
      expect(schema.shape.indexing_retry_action.safeParse('delete').success).toBe(false)

      for (const value of ['Indexing failed', null])
        expect(schema.shape.error.safeParse(value).success).toBe(true)
      expect(schema.shape.error.safeParse(500).success).toBe(false)
    }
  })

  it('validates pipeline datasource and response mode values at runtime', () => {
    const body = {
      inputs: {},
      datasource_type: 'local_file',
      datasource_info_list: [],
      start_node_id: 'node-1',
      is_published: false,
      response_mode: 'blocking',
    }

    expect(zPostDatasetsByDatasetIdPipelineRunBody.safeParse(body).success).toBe(true)
    expect(
      zPostDatasetsByDatasetIdPipelineRunBody.safeParse({ ...body, response_mode: 'invalid' })
        .success,
    ).toBe(false)
    expect(
      zPostDatasetsByDatasetIdPipelineRunBody.safeParse({ ...body, datasource_type: 'invalid' })
        .success,
    ).toBe(false)
  })

  it('preserves external provider failures as a service error', () => {
    const failure = {
      code: 'external_knowledge_failed',
      status: 502,
      message: 'Provider unavailable',
    }

    expect(zExternalKnowledgeFailedError.parse(failure)).toEqual(failure)
    expect(zExternalKnowledgeFailedError.safeParse({ ...failure, status: 400 }).success).toBe(false)
  })

  it('accepts an absent processing rule as an object rather than null', () => {
    expect(
      zDocumentDetailResponse.parse({ id: 'document', document_process_rule: {} })
        .document_process_rule,
    ).toEqual({})
    expect(
      zDocumentDetailResponse.safeParse({ id: 'document', document_process_rule: null }).success,
    ).toBe(false)
  })

  it('preserves external knowledge retrieval records', () => {
    const response = {
      query: { content: 'query' },
      records: [
        { content: 'External text', title: 'Guide', score: 0.8, metadata: { source: 'remote' } },
      ],
    }

    for (const schema of [zHitTestingResponse, zConsoleHitTestingResponse]) {
      expect(schema.parse(response)).toEqual(response)
      expect(
        schema.safeParse({
          query: response.query,
          records: [{ segment: { id: 'invalid' } }],
        }).success,
      ).toBe(false)
    }
  })

  it('keeps JSON int64 values as numbers', () => {
    const result = zFileResponse.parse({
      created_at: 1_700_000_000,
      id: '00000000-0000-4000-8000-000000000001',
      name: 'example.txt',
      size: 42,
    })

    expect(result.created_at).toBe(1_700_000_000)
    expect(typeof result.created_at).toBe('number')
  })

  it('requires a source for every file transfer method', () => {
    const request = {
      inputs: {},
      query: 'hello',
      response_mode: 'blocking' as const,
      user: 'user-1',
    }

    expect(
      zCompletionRequestPayloadWithUser.safeParse({
        ...request,
        files: [
          {
            transfer_method: 'remote_url',
            type: 'image',
            url: 'https://example.com/image.png',
          },
        ],
      }).success,
    ).toBe(true)
    expect(
      zCompletionRequestPayloadWithUser.safeParse({
        ...request,
        files: [{ transfer_method: 'remote_url', type: 'image' }],
      }).success,
    ).toBe(false)
    expect(
      zCompletionRequestPayloadWithUser.safeParse({
        ...request,
        files: [
          {
            transfer_method: 'local_file',
            type: 'image',
            url: 'https://example.com/image.png',
          },
        ],
      }).success,
    ).toBe(false)
  })

  it('rejects malformed user input form items', () => {
    const parameters = {
      annotation_reply: { enabled: false },
      file_upload: { enabled: false },
      more_like_this: { enabled: false },
      opening_statement: null,
      retriever_resource: { enabled: false },
      sensitive_word_avoidance: { enabled: false },
      speech_to_text: { enabled: false },
      suggested_questions: [],
      suggested_questions_after_answer: { enabled: false },
      system_parameters: {
        audio_file_size_limit: 15,
        file_size_limit: 15,
        image_file_size_limit: 10,
        video_file_size_limit: 100,
        workflow_file_upload_limit: 10,
      },
      text_to_speech: { enabled: false },
    }

    expect(
      zParameters.safeParse({
        ...parameters,
        user_input_form: [{ 'text-input': { label: 'Topic', required: true, variable: 'topic' } }],
      }).success,
    ).toBe(true)
    expect(zParameters.safeParse({ ...parameters, user_input_form: [42] }).success).toBe(false)
    expect(
      zParameters.safeParse({
        ...parameters,
        user_input_form: [
          {
            number: { label: 'Count', variable: 'count' },
            'text-input': { label: 'Topic', variable: 'topic' },
          },
        ],
      }).success,
    ).toBe(false)
  })

  it('accepts SSE text for mixed JSON and event-stream responses', () => {
    const eventStream = 'data: {"event":"ping"}\n\n'

    for (const responseSchema of [
      zPostChatMessagesResponse,
      zPostCompletionMessagesResponse,
      zPostDatasetsByDatasetIdPipelineRunResponse,
      zPostWorkflowsByWorkflowIdRunResponse,
      zPostWorkflowsRunResponse,
    ]) {
      expect(responseSchema.safeParse(eventStream).success).toBe(true)
    }
  })

  it('accepts the published knowledge pipeline JSON response', () => {
    expect(
      zPostDatasetsByDatasetIdPipelineRunResponse.safeParse({
        batch: '20260825123456123456',
        dataset: {
          chunk_structure: 'text_model',
          description: '',
          id: 'dataset-1',
          name: 'Knowledge Base',
        },
        documents: [],
      }).success,
    ).toBe(true)
  })
})
