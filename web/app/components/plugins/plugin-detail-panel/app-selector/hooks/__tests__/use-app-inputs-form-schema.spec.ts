import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { BlockEnum, InputVarType, SupportUploadFileTypes } from '@/app/components/workflow/types'
import { AppModeEnum, Resolution } from '@/types/app'
import { useAppInputsFormSchema } from '../use-app-inputs-form-schema'

let mockAppDetailData: Record<string, unknown> | null = null
let mockAppWorkflowData: Record<string, unknown> | null = null
let mockFileUploadConfigIsError = false
let mockFileUploadConfigIsFetching = false
const mockAppRefetch = vi.fn()
const mockFileUploadConfigRefetch = vi.fn()
const mockWorkflowRefetch = vi.fn()

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: mockAppDetailData,
    isError: false,
    isFetching: false,
    refetch: mockAppRefetch,
  }),
}))

vi.mock('@/service/use-common', () => ({
  useFileUploadConfig: () => ({
    data: {
      file_size_limit: 15,
      image_file_size_limit: 10,
    },
    isError: mockFileUploadConfigIsError,
    isFetching: mockFileUploadConfigIsFetching,
    refetch: mockFileUploadConfigRefetch,
  }),
}))

vi.mock('@/service/use-workflow', () => ({
  useAppWorkflow: () => ({
    data: mockAppWorkflowData,
    isError: false,
    isFetching: false,
    refetch: mockWorkflowRefetch,
  }),
}))

describe('useAppInputsFormSchema', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAppDetailData = null
    mockAppWorkflowData = null
    mockFileUploadConfigIsError = false
    mockFileUploadConfigIsFetching = false
  })

  it('should build basic app schemas and append image upload support', () => {
    mockAppDetailData = {
      id: 'app-1',
      mode: AppModeEnum.COMPLETION,
      model_config: {
        user_input_form: [
          {
            'text-input': {
              label: 'Question',
              variable: 'question',
            },
          },
        ],
        file_upload: {
          enabled: true,
          image: {
            enabled: true,
            detail: Resolution.high,
            number_limits: 2,
            transfer_methods: ['local_file'],
          },
          allowed_file_types: [SupportUploadFileTypes.image],
          allowed_file_extensions: ['.png'],
          allowed_file_upload_methods: ['local_file'],
          number_limits: 2,
        },
      },
    }

    const { result } = renderHook(() =>
      useAppInputsFormSchema({
        appDetail: {
          id: 'app-1',
          mode: AppModeEnum.COMPLETION,
        } as never,
      }),
    )

    expect(result.current.isLoading).toBe(false)
    expect(result.current.inputFormSchema).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          variable: 'question',
          type: 'text-input',
        }),
        expect.objectContaining({
          variable: '#image#',
          type: InputVarType.singleFile,
          allowed_file_extensions: ['.png'],
        }),
      ]),
    )
  })

  it('should build workflow schemas from start node variables', () => {
    mockAppDetailData = {
      id: 'app-2',
      mode: AppModeEnum.WORKFLOW,
    }
    mockAppWorkflowData = {
      graph: {
        nodes: [
          {
            data: {
              type: BlockEnum.Start,
              variables: [
                {
                  label: 'Attachments',
                  variable: 'attachments',
                  type: InputVarType.multiFiles,
                },
              ],
            },
          },
        ],
      },
      features: {},
    }

    const { result } = renderHook(() =>
      useAppInputsFormSchema({
        appDetail: {
          id: 'app-2',
          mode: AppModeEnum.WORKFLOW,
        } as never,
      }),
    )

    expect(result.current.inputFormSchema).toEqual([
      expect.objectContaining({
        variable: 'attachments',
        type: InputVarType.multiFiles,
        fileUploadConfig: expect.any(Object),
      }),
    ])
  })

  it('should return an empty schema when app detail is unavailable', () => {
    const { result } = renderHook(() =>
      useAppInputsFormSchema({
        appDetail: {
          id: 'missing-app',
          mode: AppModeEnum.CHAT,
        } as never,
      }),
    )

    expect(result.current.inputFormSchema).toEqual([])
  })

  it('should keep text inputs available while file upload configuration is unavailable', () => {
    mockFileUploadConfigIsError = true
    mockFileUploadConfigIsFetching = true
    mockAppDetailData = {
      id: 'app-1',
      mode: AppModeEnum.CHAT,
      model_config: {
        user_input_form: [
          {
            'text-input': {
              label: 'Question',
              variable: 'question',
            },
          },
        ],
      },
    }

    const { result } = renderHook(() =>
      useAppInputsFormSchema({
        appDetail: {
          id: 'app-1',
          mode: AppModeEnum.CHAT,
        } as never,
      }),
    )

    expect(result.current.isLoading).toBe(false)
    expect(result.current.isError).toBe(false)
    expect(result.current.inputFormSchema).toEqual([
      expect.objectContaining({
        type: 'text-input',
        variable: 'question',
      }),
    ])
  })

  it('should retry every query owned by the workflow input panel', () => {
    const { result } = renderHook(() =>
      useAppInputsFormSchema({
        appDetail: {
          id: 'app-2',
          mode: AppModeEnum.WORKFLOW,
        } as never,
      }),
    )

    result.current.retry()

    expect(mockFileUploadConfigRefetch).toHaveBeenCalledTimes(1)
    expect(mockAppRefetch).toHaveBeenCalledTimes(1)
    expect(mockWorkflowRefetch).toHaveBeenCalledTimes(1)
  })
})
