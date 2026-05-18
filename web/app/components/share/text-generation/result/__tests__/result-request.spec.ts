import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { PromptConfig } from '@/models/debug'
import type { VisionFile, VisionSettings } from '@/types/app'
import { Resolution, TransferMethod } from '@/types/app'
import { buildResultRequestData, validateResultRequest } from '../result-request'

const createTranslator = () => vi.fn((key: string) => key)

const createFileEntity = (overrides: Partial<FileEntity> = {}): FileEntity => ({
  id: 'file-1',
  name: 'example.txt',
  size: 128,
  type: 'text/plain',
  progress: 100,
  transferMethod: TransferMethod.local_file,
  supportFileType: 'document',
  uploadedId: 'uploaded-1',
  url: 'https://example.com/file.txt',
  ...overrides,
})

const createVisionFile = (overrides: Partial<VisionFile> = {}): VisionFile => ({
  type: 'image',
  transfer_method: TransferMethod.local_file,
  upload_file_id: 'upload-1',
  url: 'https://example.com/image.png',
  ...overrides,
})

const promptConfig: PromptConfig = {
  prompt_template: 'template',
  prompt_variables: [
    { key: 'name', name: 'Name', type: 'string', required: true },
    { key: 'enabled', name: 'Enabled', type: 'boolean', required: true },
    { key: 'file', name: 'File', type: 'file', required: false },
    { key: 'files', name: 'Files', type: 'file-list', required: false },
  ],
}

const visionConfig: VisionSettings = {
  enabled: true,
  number_limits: 2,
  detail: Resolution.low,
  transfer_methods: [TransferMethod.local_file],
}

describe('result-request', () => {
  it('should reject missing required non-boolean inputs', () => {
    const t = createTranslator()

    const result = validateResultRequest({
      completionFiles: [],
      inputs: {
        enabled: false,
      },
      isCallBatchAPI: false,
      promptConfig,
      t,
    })

    expect(result).toEqual({
      canSend: false,
      notification: {
        type: 'error',
        message: 'errorMessage.valueOfVarRequired',
      },
    })
  })

  it('should allow required number inputs with a value of zero', () => {
    const result = validateResultRequest({
      completionFiles: [],
      inputs: {
        count: 0,
      },
      isCallBatchAPI: false,
      promptConfig: {
        prompt_template: 'template',
        prompt_variables: [
          { key: 'count', name: 'Count', type: 'number', required: true },
        ],
      },
      t: createTranslator(),
    })

    expect(result).toEqual({ canSend: true })
  })

  it('should reject required text inputs that only contain whitespace', () => {
    const result = validateResultRequest({
      completionFiles: [],
      inputs: {
        name: '   ',
      },
      isCallBatchAPI: false,
      promptConfig: {
        prompt_template: 'template',
        prompt_variables: [
          { key: 'name', name: 'Name', type: 'string', required: true },
        ],
      },
      t: createTranslator(),
    })

    expect(result).toEqual({
      canSend: false,
      notification: {
        type: 'error',
        message: 'errorMessage.valueOfVarRequired',
      },
    })
  })

  it('should reject required file lists when no files are selected', () => {
    const result = validateResultRequest({
      completionFiles: [],
      inputs: {
        files: [],
      },
      isCallBatchAPI: false,
      promptConfig: {
        prompt_template: 'template',
        prompt_variables: [
          { key: 'files', name: 'Files', type: 'file-list', required: true },
        ],
      },
      t: createTranslator(),
    })

    expect(result).toEqual({
      canSend: false,
      notification: {
        type: 'error',
        message: 'errorMessage.valueOfVarRequired',
      },
    })
  })

  it('should allow required file inputs when a file is selected', () => {
    const result = validateResultRequest({
      completionFiles: [],
      inputs: {
        file: createFileEntity(),
      },
      isCallBatchAPI: false,
      promptConfig: {
        prompt_template: 'template',
        prompt_variables: [
          { key: 'file', name: 'File', type: 'file', required: true },
        ],
      },
      t: createTranslator(),
    })

    expect(result).toEqual({ canSend: true })
  })

  it('should reject pending local uploads outside batch mode', () => {
    const t = createTranslator()

    const result = validateResultRequest({
      completionFiles: [
        createVisionFile({ upload_file_id: '' }),
      ],
      inputs: {
        name: 'Alice',
      },
      isCallBatchAPI: false,
      promptConfig,
      t,
    })

    expect(result).toEqual({
      canSend: false,
      notification: {
        type: 'info',
        message: 'errorMessage.waitForFileUpload',
      },
    })
  })

  it('should handle missing prompt metadata with and without pending uploads', () => {
    const t = createTranslator()

    const blocked = validateResultRequest({
      completionFiles: [
        createVisionFile({ upload_file_id: '' }),
      ],
      inputs: {},
      isCallBatchAPI: false,
      promptConfig: null,
      t,
    })

    const allowed = validateResultRequest({
      completionFiles: [],
      inputs: {},
      isCallBatchAPI: false,
      promptConfig: null,
      t,
    })

    expect(blocked).toEqual({
      canSend: false,
      notification: {
        type: 'info',
        message: 'errorMessage.waitForFileUpload',
      },
    })
    expect(allowed).toEqual({ canSend: true })
  })

  it('should skip validation in batch mode', () => {
    const result = validateResultRequest({
      completionFiles: [
        createVisionFile({ upload_file_id: '' }),
      ],
      inputs: {},
      isCallBatchAPI: true,
      promptConfig,
      t: createTranslator(),
    })

    expect(result).toEqual({ canSend: true })
  })

  it('should build request data for single and list file inputs', () => {
    const file = createFileEntity()
    const secondFile = createFileEntity({
      id: 'file-2',
      name: 'second.txt',
      uploadedId: 'uploaded-2',
      url: 'https://example.com/second.txt',
    })

    const result = buildResultRequestData({
      completionFiles: [
        createVisionFile(),
        createVisionFile({
          transfer_method: TransferMethod.remote_url,
          upload_file_id: '',
          url: 'https://example.com/remote.png',
        }),
      ],
      inputs: {
        enabled: true,
        file,
        files: [file, secondFile],
        name: 'Alice',
      },
      promptConfig,
      visionConfig,
    })

    expect(result).toEqual({
      files: [
        expect.objectContaining({
          transfer_method: TransferMethod.local_file,
          upload_file_id: 'upload-1',
          url: '',
        }),
        expect.objectContaining({
          transfer_method: TransferMethod.remote_url,
          url: 'https://example.com/remote.png',
        }),
      ],
      inputs: {
        enabled: true,
        file: {
          type: 'document',
          transfer_method: TransferMethod.local_file,
          upload_file_id: 'uploaded-1',
          url: 'https://example.com/file.txt',
        },
        files: [
          {
            type: 'document',
            transfer_method: TransferMethod.local_file,
            upload_file_id: 'uploaded-1',
            url: 'https://example.com/file.txt',
          },
          {
            type: 'document',
            transfer_method: TransferMethod.local_file,
            upload_file_id: 'uploaded-2',
            url: 'https://example.com/second.txt',
          },
        ],
        name: 'Alice',
      },
    })
  })
})
