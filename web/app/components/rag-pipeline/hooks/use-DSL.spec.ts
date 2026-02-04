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

const mockDownloadBlob = vi.fn()
vi.mock('@/utils/download', () => ({
  downloadBlob: (...args: unknown[]) => mockDownloadBlob(...args),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/app/components/workflow/constants', () => ({
  DSL_EXPORT_CHECK: 'DSL_EXPORT_CHECK',
}))

// ============================================================================
// Tests
// ============================================================================

describe('useDSL', () => {
  let mockLink: { href: string, download: string, click: ReturnType<typeof vi.fn>, style: { display: string }, remove: ReturnType<typeof vi.fn> }
  let originalCreateElement: typeof document.createElement
  let originalAppendChild: typeof document.body.appendChild
  let mockCreateObjectURL: ReturnType<typeof vi.spyOn>
  let mockRevokeObjectURL: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()

    // Create a proper mock link element with all required properties for downloadBlob
    mockLink = {
      href: '',
      download: '',
      click: vi.fn(),
      style: { display: '' },
      remove: vi.fn(),
    }

    // Save original and mock selectively - only intercept 'a' elements
    originalCreateElement = document.createElement.bind(document)
    document.createElement = vi.fn((tagName: string) => {
      if (tagName === 'a') {
        return mockLink as unknown as HTMLElement
      }
      return originalCreateElement(tagName)
    }) as typeof document.createElement

    // Mock document.body.appendChild for downloadBlob
    originalAppendChild = document.body.appendChild.bind(document.body)
    document.body.appendChild = vi.fn(<T extends Node>(node: T): T => node) as typeof document.body.appendChild

    // downloadBlob uses window.URL, not URL
    mockCreateObjectURL = vi.spyOn(window.URL, 'createObjectURL').mockReturnValue('blob:test-url')
    mockRevokeObjectURL = vi.spyOn(window.URL, 'revokeObjectURL').mockImplementation(() => {})

    // Default store state
    mockGetState.mockReturnValue({
      pipelineId: 'test-pipeline-id',
      knowledgeName: 'Test Knowledge Base',
    })

    mockDoSyncWorkflowDraft.mockResolvedValue(undefined)
    mockExportPipelineConfig.mockResolvedValue({ data: 'yaml-content' })
    mockFetchWorkflowDraft.mockResolvedValue({ environment_variables: [] })
  })

  afterEach(() => {
    document.createElement = originalCreateElement
    document.body.appendChild = originalAppendChild
    mockCreateObjectURL.mockRestore()
    mockRevokeObjectURL.mockRestore()
    vi.clearAllMocks()
  })

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
      const { result } = renderHook(() => useDSL())

      await act(async () => {
        await result.current.handleExportDSL()
      })

      expect(mockDownloadBlob).toHaveBeenCalled()
    })

    it('should set correct download filename', async () => {
      const { result } = renderHook(() => useDSL())

      await act(async () => {
        await result.current.handleExportDSL()
      })

      expect(mockDownloadBlob).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: 'Test Knowledge Base.pipeline',
        }),
      )
    })

    it('should pass blob data to downloadBlob', async () => {
      const { result } = renderHook(() => useDSL())

      await act(async () => {
        await result.current.handleExportDSL()
      })

      expect(mockDownloadBlob).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.any(Blob),
        }),
      )
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
