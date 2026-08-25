import { describe, expect, it } from 'vite-plus/test'
import { zFileResponse } from './generated/api/console/files/zod.gen'
import { zCompletionRequestPayloadWithUser, zParameters } from './generated/api/service/zod.gen'

describe('generated Service API schemas', () => {
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
})
