import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================================
// Import after mocks
// ============================================================================

import { useDSL } from './use-DSL'

// ============================================================================
// Mocks
// ============================================================================

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

// Mock toast context
const mockNotify = vi.fn()
vi.mock('@/app/components/base/toast', () => ({
  useToastContext: () => ({
    notify: mockNotify,
  }),
}))

// Mock event emitter context
const mockEmit = vi.fn()
vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: {
      emit: mockEmit,
    },
  }),
}))

// Mock workflow store
const mockWorkflowStoreGetState = vi.fn()
vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => ({
    getState: mockWorkflowStoreGetState,
  }),
}))

// Mock useNodesSyncDraft
const mockDoSyncWorkflowDraft = vi.fn()
vi.mock('./use-nodes-sync-draft', () => ({
  useNodesSyncDraft: () => ({
    doSyncWorkflowDraft: mockDoSyncWorkflowDraft,
  }),
}))

// Mock pipeline service
const mockExportPipelineConfig = vi.fn()
vi.mock('@/service/use-pipeline', () => ({
  useExportPipelineDSL: () => ({
    mutateAsync: mockExportPipelineConfig,
  }),
}))

// Mock download utility
const mockDownloadBlob = vi.fn()
vi.mock('@/utils/download', () => ({
  downloadBlob: (...args: unknown[]) => mockDownloadBlob(...args),
}))

// Mock workflow service
const mockFetchWorkflowDraft = vi.fn()
vi.mock('@/service/workflow', () => ({
  fetchWorkflowDraft: (url: string) => mockFetchWorkflowDraft(url),
}))

// Mock workflow constants
vi.mock('@/app/components/workflow/constants', () => ({
  DSL_EXPORT_CHECK: 'DSL_EXPORT_CHECK',
}))

// ============================================================================
// Tests
// ============================================================================

describe('useDSL', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Default store state
    mockWorkflowStoreGetState.mockReturnValue({
      pipelineId: 'test-pipeline-id',
      knowledgeName: 'Test Knowledge Base',
    })

    mockDoSyncWorkflowDraft.mockResolvedValue(undefined)
    mockExportPipelineConfig.mockResolvedValue({ data: 'yaml-content' })
    mockFetchWorkflowDraft.mockResolvedValue({
      environment_variables: [],
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('hook initialization', () => {
    it('should return exportCheck function', () => {
      const { result } = renderHook(() => useDSL())

      expect(result.current.exportCheck).toBeDefined()
      expect(typeof result.current.exportCheck).toBe('function')
    })

    it('should return handleExportDSL function', () => {
      const { result } = renderHook(() => useDSL())

      expect(result.current.handleExportDSL).toBeDefined()
      expect(typeof result.current.handleExportDSL).toBe('function')
    })
  })

  describe('handleExportDSL', () => {
    it('should not export when pipelineId is missing', async () => {
      mockWorkflowStoreGetState.mockReturnValue({
        pipelineId: undefined,
        knowledgeName: 'Test',
      })

      const { result } = renderHook(() => useDSL())

      await act(async () => {
        await result.current.handleExportDSL()
      })

      expect(mockDoSyncWorkflowDraft).not.toHaveBeenCalled()
      expect(mockExportPipelineConfig).not.toHaveBeenCalled()
    })

    it('should sync workflow draft before export', async () => {
      const { result } = renderHook(() => useDSL())

      await act(async () => {
        await result.current.handleExportDSL()
      })

      expect(mockDoSyncWorkflowDraft).toHaveBeenCalled()
    })

    it('should call exportPipelineConfig with correct params', async () => {
      const { result } = renderHook(() => useDSL())

      await act(async () => {
        await result.current.handleExportDSL(true)
      })

      expect(mockExportPipelineConfig).toHaveBeenCalledWith({
        pipelineId: 'test-pipeline-id',
        include: true,
      })
    })

    it('should create and download file', async () => {
      const { result } = renderHook(() => useDSL())

      await act(async () => {
        await result.current.handleExportDSL()
      })

      expect(mockDownloadBlob).toHaveBeenCalled()
    })

    it('should use correct file extension for download', async () => {
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

    it('should show error notification on export failure', async () => {
      mockExportPipelineConfig.mockRejectedValue(new Error('Export failed'))

      const { result } = renderHook(() => useDSL())

      await act(async () => {
        await result.current.handleExportDSL()
      })

      expect(mockNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'exportFailed',
      })
    })
  })

  describe('exportCheck', () => {
    it('should not check when pipelineId is missing', async () => {
      mockWorkflowStoreGetState.mockReturnValue({
        pipelineId: undefined,
        knowledgeName: 'Test',
      })

      const { result } = renderHook(() => useDSL())

      await act(async () => {
        await result.current.exportCheck()
      })

      expect(mockFetchWorkflowDraft).not.toHaveBeenCalled()
    })

    it('should fetch workflow draft', async () => {
      const { result } = renderHook(() => useDSL())

      await act(async () => {
        await result.current.exportCheck()
      })

      expect(mockFetchWorkflowDraft).toHaveBeenCalledWith('/rag/pipelines/test-pipeline-id/workflows/draft')
    })

    it('should directly export when no secret environment variables', async () => {
      mockFetchWorkflowDraft.mockResolvedValue({
        environment_variables: [
          { id: '1', value_type: 'string', value: 'test' },
        ],
      })

      const { result } = renderHook(() => useDSL())

      await act(async () => {
        await result.current.exportCheck()
      })

      // Should call doSyncWorkflowDraft (which means handleExportDSL was called)
      expect(mockDoSyncWorkflowDraft).toHaveBeenCalled()
    })

    it('should emit DSL_EXPORT_CHECK event when secret variables exist', async () => {
      mockFetchWorkflowDraft.mockResolvedValue({
        environment_variables: [
          { id: '1', value_type: 'secret', value: 'secret-value' },
        ],
      })

      const { result } = renderHook(() => useDSL())

      await act(async () => {
        await result.current.exportCheck()
      })

      expect(mockEmit).toHaveBeenCalledWith({
        type: 'DSL_EXPORT_CHECK',
        payload: {
          data: [{ id: '1', value_type: 'secret', value: 'secret-value' }],
        },
      })
    })

    it('should show error notification on check failure', async () => {
      mockFetchWorkflowDraft.mockRejectedValue(new Error('Fetch failed'))

      const { result } = renderHook(() => useDSL())

      await act(async () => {
        await result.current.exportCheck()
      })

      expect(mockNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'exportFailed',
      })
    })

    it('should filter only secret environment variables', async () => {
      mockFetchWorkflowDraft.mockResolvedValue({
        environment_variables: [
          { id: '1', value_type: 'string', value: 'plain' },
          { id: '2', value_type: 'secret', value: 'secret1' },
          { id: '3', value_type: 'number', value: '123' },
          { id: '4', value_type: 'secret', value: 'secret2' },
        ],
      })

      const { result } = renderHook(() => useDSL())

      await act(async () => {
        await result.current.exportCheck()
      })

      expect(mockEmit).toHaveBeenCalledWith({
        type: 'DSL_EXPORT_CHECK',
        payload: {
          data: [
            { id: '2', value_type: 'secret', value: 'secret1' },
            { id: '4', value_type: 'secret', value: 'secret2' },
          ],
        },
      })
    })

    it('should handle empty environment variables', async () => {
      mockFetchWorkflowDraft.mockResolvedValue({
        environment_variables: [],
      })

      const { result } = renderHook(() => useDSL())

      await act(async () => {
        await result.current.exportCheck()
      })

      // Should directly call handleExportDSL since no secrets
      expect(mockEmit).not.toHaveBeenCalled()
      expect(mockDoSyncWorkflowDraft).toHaveBeenCalled()
    })

    it('should handle undefined environment variables', async () => {
      mockFetchWorkflowDraft.mockResolvedValue({
        environment_variables: undefined,
      })

      const { result } = renderHook(() => useDSL())

      await act(async () => {
        await result.current.exportCheck()
      })

      // Should directly call handleExportDSL since no secrets
      expect(mockEmit).not.toHaveBeenCalled()
    })
  })
})
