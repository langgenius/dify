import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDSL } from './use-DSL'

// Mock dependencies
const mockNotify = vi.fn()
vi.mock('@/app/components/base/toast', () => ({
  useToastContext: () => ({ notify: mockNotify }),
}))

const mockEventEmitter = { emit: vi.fn() }
vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({ eventEmitter: mockEventEmitter }),
}))

const mockDoSyncWorkflowDraft = vi.fn()
vi.mock('./use-nodes-sync-draft', () => ({
  useNodesSyncDraft: () => ({ doSyncWorkflowDraft: mockDoSyncWorkflowDraft }),
}))

const mockGetState = vi.fn()
vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => ({ getState: mockGetState }),
}))

const mockExportPipelineConfig = vi.fn()
vi.mock('@/service/use-pipeline', () => ({
  useExportPipelineDSL: () => ({ mutateAsync: mockExportPipelineConfig }),
}))

const mockFetchWorkflowDraft = vi.fn()
vi.mock('@/service/workflow', () => ({
  fetchWorkflowDraft: (...args: unknown[]) => mockFetchWorkflowDraft(...args),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

describe('useDSL', () => {
  let originalCreateObjectURL: typeof URL.createObjectURL
  let originalRevokeObjectURL: typeof URL.revokeObjectURL
  let mockCreateObjectURL: ReturnType<typeof vi.fn<(obj: Blob | MediaSource) => string>>
  let mockRevokeObjectURL: ReturnType<typeof vi.fn<(url: string) => void>>
  let mockClick: ReturnType<typeof vi.fn<() => void>>

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetState.mockReturnValue({ pipelineId: 'test-pipeline-id', knowledgeName: 'test-knowledge' })
    mockDoSyncWorkflowDraft.mockResolvedValue(undefined)
    mockExportPipelineConfig.mockResolvedValue({ data: 'yaml-content' })
    mockFetchWorkflowDraft.mockResolvedValue({ environment_variables: [] })

    // Save originals
    originalCreateObjectURL = URL.createObjectURL
    originalRevokeObjectURL = URL.revokeObjectURL

    // Setup URL mocks with correct types
    mockCreateObjectURL = vi.fn<(obj: Blob | MediaSource) => string>().mockReturnValue('blob:test-url')
    mockRevokeObjectURL = vi.fn<(url: string) => void>()
    URL.createObjectURL = mockCreateObjectURL
    URL.revokeObjectURL = mockRevokeObjectURL

    // Setup click mock
    mockClick = vi.fn<() => void>()
  })

  afterEach(() => {
    // Restore originals
    URL.createObjectURL = originalCreateObjectURL
    URL.revokeObjectURL = originalRevokeObjectURL
    vi.restoreAllMocks()
  })

  // Helper to setup anchor element mock
  const setupAnchorMock = () => {
    const realCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      if (tagName === 'a') {
        const anchor = realCreateElement('a')
        ;(anchor as HTMLAnchorElement).click = mockClick
        return anchor
      }
      return realCreateElement(tagName)
    })
  }

  describe('handleExportDSL', () => {
    it('should return early when pipelineId is not set', async () => {
      mockGetState.mockReturnValue({ pipelineId: null, knowledgeName: 'test' })

      const { result } = renderHook(() => useDSL())

      await act(async () => {
        await result.current.handleExportDSL()
      })

      expect(mockDoSyncWorkflowDraft).not.toHaveBeenCalled()
    })

    it('should create and download file', async () => {
      setupAnchorMock()

      const { result } = renderHook(() => useDSL())

      await act(async () => {
        await result.current.handleExportDSL()
      })

      await waitFor(() => {
        expect(mockDoSyncWorkflowDraft).toHaveBeenCalled()
        expect(mockExportPipelineConfig).toHaveBeenCalledWith({
          pipelineId: 'test-pipeline-id',
          include: false,
        })
        expect(document.createElement).toHaveBeenCalledWith('a')
        expect(mockCreateObjectURL).toHaveBeenCalled()
        expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:test-url')
      })
    })

    it('should trigger download click', async () => {
      setupAnchorMock()

      const { result } = renderHook(() => useDSL())

      await act(async () => {
        await result.current.handleExportDSL()
      })

      await waitFor(() => {
        expect(mockClick).toHaveBeenCalled()
      })
    })

    it('should handle export error', async () => {
      mockExportPipelineConfig.mockRejectedValue(new Error('Export failed'))

      const { result } = renderHook(() => useDSL())

      await act(async () => {
        await result.current.handleExportDSL()
      })

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith({
          type: 'error',
          message: 'exportFailed',
        })
      })
    })

    it('should pass include parameter', async () => {
      setupAnchorMock()

      const { result } = renderHook(() => useDSL())

      await act(async () => {
        await result.current.handleExportDSL(true)
      })

      await waitFor(() => {
        expect(mockExportPipelineConfig).toHaveBeenCalledWith({
          pipelineId: 'test-pipeline-id',
          include: true,
        })
      })
    })
  })

  describe('exportCheck', () => {
    it('should return early when pipelineId is not set', async () => {
      mockGetState.mockReturnValue({ pipelineId: null })

      const { result } = renderHook(() => useDSL())

      await act(async () => {
        await result.current.exportCheck()
      })

      expect(mockFetchWorkflowDraft).not.toHaveBeenCalled()
    })

    it('should call handleExportDSL directly when no secret variables', async () => {
      setupAnchorMock()
      mockFetchWorkflowDraft.mockResolvedValue({ environment_variables: [] })

      const { result } = renderHook(() => useDSL())

      await act(async () => {
        await result.current.exportCheck()
      })

      await waitFor(() => {
        expect(mockFetchWorkflowDraft).toHaveBeenCalledWith('/rag/pipelines/test-pipeline-id/workflows/draft')
        expect(mockDoSyncWorkflowDraft).toHaveBeenCalled()
      })
    })

    it('should emit event when secret variables exist', async () => {
      const secretVars = [{ value_type: 'secret', name: 'API_KEY' }]
      mockFetchWorkflowDraft.mockResolvedValue({ environment_variables: secretVars })

      const { result } = renderHook(() => useDSL())

      await act(async () => {
        await result.current.exportCheck()
      })

      await waitFor(() => {
        expect(mockEventEmitter.emit).toHaveBeenCalledWith({
          type: expect.any(String),
          payload: {
            data: secretVars,
          },
        })
      })
    })

    it('should handle export check error', async () => {
      mockFetchWorkflowDraft.mockRejectedValue(new Error('Fetch failed'))

      const { result } = renderHook(() => useDSL())

      await act(async () => {
        await result.current.exportCheck()
      })

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith({
          type: 'error',
          message: 'exportFailed',
        })
      })
    })
  })
})
