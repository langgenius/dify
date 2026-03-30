import type { App } from '@/types/app'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InputVarType, SupportUploadFileTypes } from '@/app/components/workflow/types'
import { AppModeEnum, Resolution, TransferMethod } from '@/types/app'
import { useAppInputsFormSchema } from '../use-app-inputs-form-schema'

let mockAppDetailData: App | null = null
let mockAppDetailLoading = false
let mockWorkflowData: Record<string, unknown> | null = null
let mockWorkflowLoading = false
let mockFileUploadConfig: Record<string, unknown> | undefined

vi.mock('@/service/use-apps', () => ({
  useAppDetail: () => ({
    data: mockAppDetailData,
    isFetching: mockAppDetailLoading,
  }),
}))

vi.mock('@/service/use-workflow', () => ({
  useAppWorkflow: () => ({
    data: mockWorkflowData,
    isFetching: mockWorkflowLoading,
  }),
}))

vi.mock('@/service/use-common', () => ({
  useFileUploadConfig: () => ({
    data: mockFileUploadConfig,
  }),
}))

const createAppDetail = (overrides: Partial<App> = {}): App => ({
  id: 'app-1',
  mode: AppModeEnum.CHAT,
  name: 'Test App',
  icon: '',
  icon_background: '',
  icon_type: 'emoji',
  model_config: {
    user_input_form: [],
  },
  ...overrides,
} as App)

describe('useAppInputsFormSchema', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAppDetailLoading = false
    mockWorkflowLoading = false
    mockFileUploadConfig = { image_file_size_limit: 10 }
    mockWorkflowData = null
    mockAppDetailData = null
  })

  it('should build basic app schema and attach fileUploadConfig for file inputs', () => {
    mockAppDetailData = createAppDetail({
      mode: AppModeEnum.CHAT,
      model_config: {
        user_input_form: [
          { paragraph: { label: 'Summary', variable: 'summary' } },
          { file: { label: 'Attachment', variable: 'attachment' } },
          { external_data_tool: { variable: 'ignored' } },
        ],
      } as unknown as App['model_config'],
    })

    const { result } = renderHook(() => useAppInputsFormSchema({
      appDetail: createAppDetail({ mode: AppModeEnum.CHAT }),
    }))

    expect(result.current.inputFormSchema).toEqual([
      expect.objectContaining({
        label: 'Summary',
        variable: 'summary',
        type: 'paragraph',
      }),
      expect.objectContaining({
        label: 'Attachment',
        variable: 'attachment',
        type: 'file',
        fileUploadConfig: mockFileUploadConfig,
      }),
    ])
  })

  it('should build workflow schema and attach fileUploadConfig for file variables', () => {
    mockAppDetailData = createAppDetail({ mode: AppModeEnum.WORKFLOW })
    mockWorkflowData = {
      graph: {
        nodes: [
          {
            data: {
              type: 'start',
              variables: [
                { type: InputVarType.textInput, label: 'Question', variable: 'question' },
                { type: InputVarType.singleFile, label: 'Image', variable: 'image' },
              ],
            },
          },
        ],
      },
      features: {},
    }

    const { result } = renderHook(() => useAppInputsFormSchema({
      appDetail: createAppDetail({ mode: AppModeEnum.WORKFLOW }),
    }))

    expect(result.current.inputFormSchema).toEqual([
      expect.objectContaining({ type: InputVarType.textInput, variable: 'question' }),
      expect.objectContaining({
        type: InputVarType.singleFile,
        variable: 'image',
        fileUploadConfig: mockFileUploadConfig,
      }),
    ])
  })

  it('should append image upload schema when completion app enables file upload', () => {
    mockAppDetailData = createAppDetail({
      mode: AppModeEnum.COMPLETION,
      model_config: {
        user_input_form: [{ 'text-input': { label: 'Prompt', variable: 'prompt' } }],
        file_upload: {
          enabled: true,
          allowed_file_types: [SupportUploadFileTypes.image],
          number_limits: 5,
          image: {
            enabled: true,
            detail: Resolution.low,
            number_limits: 4,
            transfer_methods: [TransferMethod.remote_url],
          },
        },
      } as unknown as App['model_config'],
    })

    const { result } = renderHook(() => useAppInputsFormSchema({
      appDetail: createAppDetail({ mode: AppModeEnum.COMPLETION }),
    }))

    expect(result.current.inputFormSchema).toEqual([
      expect.objectContaining({ type: 'text-input', variable: 'prompt' }),
      expect.objectContaining({
        label: 'Image Upload',
        variable: '#image#',
        type: InputVarType.singleFile,
        fileUploadConfig: mockFileUploadConfig,
        image: expect.objectContaining({
          enabled: true,
          detail: Resolution.low,
          number_limits: 4,
          transfer_methods: [TransferMethod.remote_url],
        }),
        enabled: true,
        number_limits: 5,
      }),
    ])
  })

  it('should return empty schema when workflow draft is unavailable for workflow apps', () => {
    mockAppDetailData = createAppDetail({ mode: AppModeEnum.WORKFLOW })
    mockWorkflowData = null

    const { result } = renderHook(() => useAppInputsFormSchema({
      appDetail: createAppDetail({ mode: AppModeEnum.WORKFLOW }),
    }))

    expect(result.current.inputFormSchema).toEqual([])
  })

  it('should surface loading state from app detail and workflow queries', () => {
    mockAppDetailLoading = true
    mockWorkflowLoading = true

    const { result } = renderHook(() => useAppInputsFormSchema({
      appDetail: createAppDetail({ mode: AppModeEnum.WORKFLOW }),
    }))

    expect(result.current.isLoading).toBe(true)
    expect(result.current.fileUploadConfig).toEqual(mockFileUploadConfig)
  })
})
