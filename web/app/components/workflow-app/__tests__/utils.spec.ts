import type { FileUploadConfigResponse } from '@/models/common'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import { TransferMethod } from '@/types/app'
import { buildInitialFeatures, buildTriggerStatusMap, coerceReplayUserInputs } from '../utils'

const fileUploadConfig = {
  batch_count_limit: 5,
  image_file_batch_limit: 10,
  single_chunk_attachment_limit: 5,
  attachment_image_file_size_limit: 2,
  file_size_limit: 15,
  file_upload_limit: 5,
} satisfies FileUploadConfigResponse

describe('workflow-app utils', () => {
  it('should map trigger statuses to enabled and disabled states', () => {
    expect(
      buildTriggerStatusMap([
        { node_id: 'node-1', status: 'enabled' },
        { node_id: 'node-2', status: 'disabled' },
        { node_id: 'node-3', status: 'paused' },
      ]),
    ).toEqual({
      'node-1': 'enabled',
      'node-2': 'disabled',
      'node-3': 'disabled',
    })
  })

  it('should coerce replay run inputs, omit sys keys, and stringify complex values', () => {
    expect(
      coerceReplayUserInputs({
        'sys.query': 'hidden',
        query: 'hello',
        count: 3,
        enabled: true,
        nullable: null,
        metadata: { nested: true },
      }),
    ).toEqual({
      query: 'hello',
      count: 3,
      enabled: true,
      nullable: '',
      metadata: '{"nested":true}',
    })
    expect(coerceReplayUserInputs('invalid')).toBeNull()
    expect(coerceReplayUserInputs(null)).toBeNull()
  })

  it('should build initial features with file-upload and feature fallbacks', () => {
    const result = buildInitialFeatures(
      {
        file_upload: {
          enabled: true,
          allowed_file_types: [SupportUploadFileTypes.image],
          allowed_file_extensions: ['.png'],
          allowed_file_upload_methods: [TransferMethod.local_file],
          number_limits: 2,
          image: {
            enabled: true,
            number_limits: 5,
            transfer_methods: [TransferMethod.remote_url],
          },
        },
        opening_statement: 'hello',
        suggested_questions: ['Q1'],
        suggested_questions_after_answer: {
          enabled: true,
          prompt: 'follow up',
          model: { name: 'gpt-test', provider: 'openai', mode: 'chat' },
        },
        speech_to_text: { enabled: true },
        text_to_speech: { enabled: true, language: 'en-US', voice: 'alloy' },
        retriever_resource: { enabled: true },
        sensitive_word_avoidance: { enabled: true },
        annotation_reply: {
          enabled: true,
          id: 'annotation-1',
          score_threshold: 0.8,
          embedding_model: {
            embedding_provider_name: 'openai',
            embedding_model_name: 'text-embedding-3-small',
          },
        },
      },
      fileUploadConfig,
    )

    expect(result).toMatchObject({
      file: {
        enabled: true,
        allowed_file_types: [SupportUploadFileTypes.image],
        allowed_file_extensions: ['.png'],
        allowed_file_upload_methods: [TransferMethod.local_file],
        number_limits: 2,
        fileUploadConfig,
        image: {
          enabled: true,
          number_limits: 5,
          transfer_methods: [TransferMethod.remote_url],
        },
      },
      opening: {
        enabled: true,
        opening_statement: 'hello',
        suggested_questions: ['Q1'],
      },
      suggested: {
        enabled: true,
        prompt: 'follow up',
        model: { name: 'gpt-test', provider: 'openai', mode: 'chat' },
      },
      speech2text: { enabled: true },
      text2speech: { enabled: true, language: 'en-US', voice: 'alloy' },
      citation: { enabled: true },
      moderation: { enabled: true },
      annotationReply: {
        enabled: true,
        id: 'annotation-1',
        score_threshold: 0.8,
        embedding_model: {
          embedding_provider_name: 'openai',
          embedding_model_name: 'text-embedding-3-small',
        },
      },
    })
  })

  it('normalizes nullable read fields and unsupported transfer methods', () => {
    const result = buildInitialFeatures(
      {
        file_upload: {
          enabled: null,
          allowed_file_types: null,
          allowed_file_extensions: null,
          allowed_file_upload_methods: ['unsupported'],
          number_limits: null,
          image: {
            enabled: null,
            number_limits: null,
            transfer_methods: [TransferMethod.remote_url, 'unsupported'],
          },
        },
        opening_statement: null,
        suggested_questions: null,
        suggested_questions_after_answer: { enabled: null },
        speech_to_text: null,
        text_to_speech: { enabled: null, autoPlay: 'unsupported', language: null },
        retriever_resource: { enabled: null },
        sensitive_word_avoidance: null,
        annotation_reply: { enabled: null, id: 'annotation-1' },
      },
      fileUploadConfig,
    )

    expect(result).toMatchObject({
      file: {
        enabled: false,
        allowed_file_types: [SupportUploadFileTypes.image],
        allowed_file_upload_methods: [],
        number_limits: 3,
        image: { enabled: false, number_limits: 3, transfer_methods: [TransferMethod.remote_url] },
        fileUploadConfig,
      },
      opening: { enabled: false },
      suggested: { enabled: false },
      speech2text: { enabled: false },
      text2speech: { enabled: false },
      citation: { enabled: false },
      moderation: { enabled: false },
      annotationReply: { enabled: false, id: 'annotation-1' },
    })
    expect(result.opening?.opening_statement).toBeUndefined()
    expect(result.opening?.suggested_questions).toBeUndefined()
    expect(result.text2speech?.autoPlay).toBeUndefined()
  })
})
