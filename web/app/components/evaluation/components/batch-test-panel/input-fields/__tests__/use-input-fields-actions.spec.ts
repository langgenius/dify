import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { toast } from '@/app/notifications'
import { createHttpError } from '@/service/http-error'
import { useInputFieldsActions } from '../use-input-fields-actions'

const mocks = vi.hoisted(() => ({
  buildEvaluationRunRequest: vi.fn(),
  downloadBlob: vi.fn(),
  downloadTemplate: vi.fn(),
  runEvaluation: vi.fn(),
  setBatchTab: vi.fn(),
  setSelectedRunId: vi.fn(),
  setUploadedFile: vi.fn(),
  setUploadedFileName: vi.fn(),
  templateColumnsQuery: vi.fn(),
  uploadedFileId: null as string | null,
}))

const configPayload = {
  default_metrics: [
    {
      metric: 'answer_correctness',
      node_info_list: [{ node_id: 'llm-1', title: 'Answer', type: 'llm' }],
    },
  ],
  evaluation_model: 'gpt-4o-mini',
  evaluation_model_provider: 'openai',
}

vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({ isPending: false, mutate: vi.fn() }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: () => 'translated' }),
}))

vi.mock('@/app/notifications', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}))

vi.mock('@/service/console', () => ({
  consoleQuery: {
    files: {
      upload: {
        post: { mutationOptions: () => ({}) },
      },
    },
  },
}))

vi.mock('@/utils/download', () => ({
  downloadBlob: mocks.downloadBlob,
}))

vi.mock('@/utils/format', () => ({
  formatFileSize: () => '',
}))

vi.mock('../../../../queries', () => ({
  useEvaluationActions: () => ({
    downloadTemplate: mocks.downloadTemplate,
    isDownloadingTemplate: false,
    isRunning: false,
    runEvaluation: mocks.runEvaluation,
  }),
  useEvaluationTemplateColumns: (...args: unknown[]) => mocks.templateColumnsQuery(...args),
}))

vi.mock('../../../../store', () => ({
  useEvaluationResource: () => ({
    activeBatchTab: 'input-fields',
    judgeModelId: 'openai::gpt-4o-mini',
    judgmentConfig: { conditions: [], logicalOperator: 'and' },
    metrics: [],
    selectedRunId: null,
    uploadedFileId: mocks.uploadedFileId,
    uploadedFileName: null,
  }),
  useEvaluationStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      setBatchTab: mocks.setBatchTab,
      setSelectedRunId: mocks.setSelectedRunId,
      setUploadedFile: mocks.setUploadedFile,
      setUploadedFileName: mocks.setUploadedFileName,
    }),
}))

vi.mock('../../../../store-utils', () => ({
  buildEvaluationRunRequest: mocks.buildEvaluationRunRequest,
  buildEvaluationTemplateConfigPayload: () => configPayload,
}))

describe('useInputFieldsActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.uploadedFileId = null
    mocks.downloadTemplate.mockResolvedValue(new Blob(['template']))
    mocks.templateColumnsQuery.mockReturnValue({
      data: { columns: [{ name: 'Answer : expected_output', type: 'string' }] },
      isFetching: false,
      isPending: false,
    })
  })

  it('downloads the template with the current evaluation config', async () => {
    const { result } = renderHook(() =>
      useInputFieldsActions({
        isPanelReady: true,
        isRunnable: true,
        resourceId: 'app-1',
        resourceType: 'apps',
        templateFileName: 'evaluation-template.xlsx',
      }),
    )

    await act(result.current.handleDownloadTemplate)

    expect(mocks.downloadTemplate).toHaveBeenCalledWith(configPayload)
    expect(mocks.downloadBlob).toHaveBeenCalledWith({
      data: expect.any(Blob),
      fileName: 'evaluation-template.xlsx',
    })
  })

  it('loads and downloads metric-aware template columns before judge-model setup', async () => {
    const { result } = renderHook(() =>
      useInputFieldsActions({
        isPanelReady: false,
        isRunnable: false,
        resourceId: 'app-1',
        resourceType: 'apps',
        templateFileName: 'evaluation-template.xlsx',
      }),
    )

    await act(result.current.handleDownloadTemplate)

    expect(result.current.canDownloadTemplate).toBe(true)
    expect(result.current.isTemplateColumnsLoading).toBe(false)
    expect(result.current.templateColumns).toEqual([
      { name: 'Answer : expected_output', type: 'string' },
    ])
    expect(mocks.templateColumnsQuery).toHaveBeenCalledWith(
      { resourceId: 'app-1', resourceType: 'apps' },
      configPayload,
    )
    expect(mocks.downloadTemplate).toHaveBeenCalledWith(configPayload)
  })

  it('exposes a failed first template-columns load with a retry instead of an empty list', () => {
    const error = new Error('columns unavailable')
    const refetch = vi.fn()
    mocks.templateColumnsQuery.mockReturnValue({
      data: undefined,
      error,
      isError: true,
      isFetching: false,
      isPending: false,
      refetch,
    })
    const { result } = renderHook(() =>
      useInputFieldsActions({
        isPanelReady: true,
        isRunnable: true,
        resourceId: 'app-1',
        resourceType: 'apps',
        templateFileName: 'evaluation-template.xlsx',
      }),
    )

    expect(result.current.templateColumnsLoadError).toBe(error)
    result.current.retryTemplateColumns()
    expect(refetch).toHaveBeenCalledOnce()
  })

  it('keeps the cached template columns when a refetch fails', () => {
    mocks.templateColumnsQuery.mockReturnValue({
      data: { columns: [{ name: 'Answer : expected_output', type: 'string' }] },
      error: new Error('columns unavailable'),
      isError: true,
      isFetching: false,
      isPending: false,
    })
    const { result } = renderHook(() =>
      useInputFieldsActions({
        isPanelReady: true,
        isRunnable: true,
        resourceId: 'app-1',
        resourceType: 'apps',
        templateFileName: 'evaluation-template.xlsx',
      }),
    )

    expect(result.current.templateColumnsLoadError).toBeNull()
    expect(result.current.templateColumns).toHaveLength(1)
  })

  it('reports a failed template download with its translated failure, not the server text', async () => {
    mocks.downloadTemplate.mockRejectedValueOnce(
      createHttpError(new Response(null, { status: 404 }), {
        code: 'not_found',
        message: 'Server says why',
      }),
    )
    const { result } = renderHook(() =>
      useInputFieldsActions({
        isPanelReady: true,
        isRunnable: true,
        resourceId: 'app-1',
        resourceType: 'apps',
        templateFileName: 'evaluation-template.xlsx',
      }),
    )

    await act(result.current.handleDownloadTemplate)

    expect(toast.error).toHaveBeenCalledExactlyOnceWith('translated')
    expect(mocks.downloadBlob).not.toHaveBeenCalled()
  })

  it('shows why the template could not be generated', async () => {
    const message =
      'Evaluation datasets only support string, number, and boolean inputs; unsupported input type: file.'
    mocks.downloadTemplate.mockRejectedValueOnce(
      createHttpError(new Response(null, { status: 400 }), {
        code: 'evaluation_dataset_invalid',
        message,
      }),
    )
    const { result } = renderHook(() =>
      useInputFieldsActions({
        isPanelReady: true,
        isRunnable: true,
        resourceId: 'app-1',
        resourceType: 'apps',
        templateFileName: 'evaluation-template.xlsx',
      }),
    )

    await act(result.current.handleDownloadTemplate)

    expect(toast.error).toHaveBeenCalledExactlyOnceWith(message)
  })

  it.each([
    ['evaluation_dataset_invalid', "Dataset input 'temperature' must be a number; invalid row: 7."],
    ['evaluation_framework_not_configured', 'The selected evaluation framework is not installed.'],
    ['evaluation_config_invalid', 'answer_relevancy needs a default embedding model.'],
  ])('shows the reason a run was rejected with %s', async (code, message) => {
    mocks.uploadedFileId = 'file-1'
    mocks.buildEvaluationRunRequest.mockReturnValue({ file_id: 'file-1' })
    mocks.runEvaluation.mockRejectedValueOnce(
      createHttpError(new Response(null, { status: 400 }), { code, message, status: 400 }),
    )
    const { result } = renderHook(() =>
      useInputFieldsActions({
        isPanelReady: true,
        isRunnable: true,
        resourceId: 'app-1',
        resourceType: 'apps',
        templateFileName: 'evaluation-template.xlsx',
      }),
    )

    await act(result.current.handleRun)

    expect(toast.error).toHaveBeenCalledExactlyOnceWith(message)
  })
})
