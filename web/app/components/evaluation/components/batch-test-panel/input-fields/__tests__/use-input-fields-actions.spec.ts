import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
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
    uploadedFileId: null,
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
})
