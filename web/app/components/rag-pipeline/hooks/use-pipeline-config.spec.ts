import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================================
// Import after mocks
// ============================================================================

import { usePipelineConfig } from './use-pipeline-config'

// ============================================================================
// Mocks
// ============================================================================

// Mock workflow store
const mockUseStore = vi.fn()
const mockWorkflowStoreGetState = vi.fn()

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: Record<string, unknown>) => unknown) => mockUseStore(selector),
  useWorkflowStore: () => ({
    getState: mockWorkflowStoreGetState,
  }),
}))

// Mock useWorkflowConfig
const mockUseWorkflowConfig = vi.fn()
vi.mock('@/service/use-workflow', () => ({
  useWorkflowConfig: (url: string, callback: (data: unknown) => void) => mockUseWorkflowConfig(url, callback),
}))

// Mock useDataSourceList
const mockUseDataSourceList = vi.fn()
vi.mock('@/service/use-pipeline', () => ({
  useDataSourceList: (enabled: boolean, callback: (data: unknown) => void) => mockUseDataSourceList(enabled, callback),
}))

// Mock basePath
vi.mock('@/utils/var', () => ({
  basePath: '/base',
}))

// ============================================================================
// Tests
// ============================================================================

describe('usePipelineConfig', () => {
  const mockSetNodesDefaultConfigs = vi.fn()
  const mockSetPublishedAt = vi.fn()
  const mockSetDataSourceList = vi.fn()
  const mockSetFileUploadConfig = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

    mockUseStore.mockImplementation((selector: (state: Record<string, unknown>) => unknown) => {
      const state = { pipelineId: 'test-pipeline-id' }
      return selector(state)
    })

    mockWorkflowStoreGetState.mockReturnValue({
      setNodesDefaultConfigs: mockSetNodesDefaultConfigs,
      setPublishedAt: mockSetPublishedAt,
      setDataSourceList: mockSetDataSourceList,
      setFileUploadConfig: mockSetFileUploadConfig,
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('hook initialization', () => {
    it('should render without crashing', () => {
      expect(() => renderHook(() => usePipelineConfig())).not.toThrow()
    })

    it('should call useWorkflowConfig with correct URL for nodes default configs', () => {
      renderHook(() => usePipelineConfig())

      expect(mockUseWorkflowConfig).toHaveBeenCalledWith(
        '/rag/pipelines/test-pipeline-id/workflows/default-workflow-block-configs',
        expect.any(Function),
      )
    })

    it('should call useWorkflowConfig with correct URL for published workflow', () => {
      renderHook(() => usePipelineConfig())

      expect(mockUseWorkflowConfig).toHaveBeenCalledWith(
        '/rag/pipelines/test-pipeline-id/workflows/publish',
        expect.any(Function),
      )
    })

    it('should call useWorkflowConfig with correct URL for file upload config', () => {
      renderHook(() => usePipelineConfig())

      expect(mockUseWorkflowConfig).toHaveBeenCalledWith(
        '/files/upload',
        expect.any(Function),
      )
    })

    it('should call useDataSourceList when pipelineId exists', () => {
      renderHook(() => usePipelineConfig())

      expect(mockUseDataSourceList).toHaveBeenCalledWith(true, expect.any(Function))
    })

    it('should call useDataSourceList with false when pipelineId is missing', () => {
      mockUseStore.mockImplementation((selector: (state: Record<string, unknown>) => unknown) => {
        const state = { pipelineId: undefined }
        return selector(state)
      })

      renderHook(() => usePipelineConfig())

      expect(mockUseDataSourceList).toHaveBeenCalledWith(false, expect.any(Function))
    })

    it('should use empty URL when pipelineId is missing for nodes configs', () => {
      mockUseStore.mockImplementation((selector: (state: Record<string, unknown>) => unknown) => {
        const state = { pipelineId: undefined }
        return selector(state)
      })

      renderHook(() => usePipelineConfig())

      expect(mockUseWorkflowConfig).toHaveBeenCalledWith('', expect.any(Function))
    })
  })

  describe('handleUpdateNodesDefaultConfigs', () => {
    it('should handle array format configs', () => {
      let capturedCallback: ((data: unknown) => void) | undefined
      mockUseWorkflowConfig.mockImplementation((url: string, callback: (data: unknown) => void) => {
        if (url.includes('default-workflow-block-configs')) {
          capturedCallback = callback
        }
      })

      renderHook(() => usePipelineConfig())

      const arrayConfigs = [
        { type: 'llm', config: { model: 'gpt-4' } },
        { type: 'code', config: { language: 'python' } },
      ]

      capturedCallback?.(arrayConfigs)

      expect(mockSetNodesDefaultConfigs).toHaveBeenCalledWith({
        llm: { model: 'gpt-4' },
        code: { language: 'python' },
      })
    })

    it('should handle object format configs', () => {
      let capturedCallback: ((data: unknown) => void) | undefined
      mockUseWorkflowConfig.mockImplementation((url: string, callback: (data: unknown) => void) => {
        if (url.includes('default-workflow-block-configs')) {
          capturedCallback = callback
        }
      })

      renderHook(() => usePipelineConfig())

      const objectConfigs = {
        llm: { model: 'gpt-4' },
        code: { language: 'python' },
      }

      capturedCallback?.(objectConfigs)

      expect(mockSetNodesDefaultConfigs).toHaveBeenCalledWith(objectConfigs)
    })
  })

  describe('handleUpdatePublishedAt', () => {
    it('should set published at from workflow response', () => {
      let capturedCallback: ((data: unknown) => void) | undefined
      mockUseWorkflowConfig.mockImplementation((url: string, callback: (data: unknown) => void) => {
        if (url.includes('/publish')) {
          capturedCallback = callback
        }
      })

      renderHook(() => usePipelineConfig())

      capturedCallback?.({ created_at: '2024-01-01T00:00:00Z' })

      expect(mockSetPublishedAt).toHaveBeenCalledWith('2024-01-01T00:00:00Z')
    })

    it('should handle undefined workflow response', () => {
      let capturedCallback: ((data: unknown) => void) | undefined
      mockUseWorkflowConfig.mockImplementation((url: string, callback: (data: unknown) => void) => {
        if (url.includes('/publish')) {
          capturedCallback = callback
        }
      })

      renderHook(() => usePipelineConfig())

      capturedCallback?.(undefined)

      expect(mockSetPublishedAt).toHaveBeenCalledWith(undefined)
    })
  })

  describe('handleUpdateDataSourceList', () => {
    it('should set data source list', () => {
      let capturedCallback: ((data: unknown) => void) | undefined
      mockUseDataSourceList.mockImplementation((_enabled: boolean, callback: (data: unknown) => void) => {
        capturedCallback = callback
      })

      renderHook(() => usePipelineConfig())

      const dataSourceList = [
        { declaration: { identity: { icon: '/icon.png' } } },
      ]

      capturedCallback?.(dataSourceList)

      expect(mockSetDataSourceList).toHaveBeenCalled()
    })

    it('should prepend basePath to icon if not included', () => {
      let capturedCallback: ((data: unknown) => void) | undefined
      mockUseDataSourceList.mockImplementation((_enabled: boolean, callback: (data: unknown) => void) => {
        capturedCallback = callback
      })

      renderHook(() => usePipelineConfig())

      const dataSourceList = [
        { declaration: { identity: { icon: '/icon.png' } } },
      ]

      capturedCallback?.(dataSourceList)

      // The callback modifies the array in place
      expect(dataSourceList[0].declaration.identity.icon).toBe('/base/icon.png')
    })

    it('should not modify icon if it already includes basePath', () => {
      let capturedCallback: ((data: unknown) => void) | undefined
      mockUseDataSourceList.mockImplementation((_enabled: boolean, callback: (data: unknown) => void) => {
        capturedCallback = callback
      })

      renderHook(() => usePipelineConfig())

      const dataSourceList = [
        { declaration: { identity: { icon: '/base/icon.png' } } },
      ]

      capturedCallback?.(dataSourceList)

      expect(dataSourceList[0].declaration.identity.icon).toBe('/base/icon.png')
    })

    it('should handle non-string icon', () => {
      let capturedCallback: ((data: unknown) => void) | undefined
      mockUseDataSourceList.mockImplementation((_enabled: boolean, callback: (data: unknown) => void) => {
        capturedCallback = callback
      })

      renderHook(() => usePipelineConfig())

      const dataSourceList = [
        { declaration: { identity: { icon: { url: '/icon.png' } } } },
      ]

      capturedCallback?.(dataSourceList)

      // Should not modify object icon
      expect(dataSourceList[0].declaration.identity.icon).toEqual({ url: '/icon.png' })
    })
  })

  describe('handleUpdateWorkflowFileUploadConfig', () => {
    it('should set file upload config', () => {
      let capturedCallback: ((data: unknown) => void) | undefined
      mockUseWorkflowConfig.mockImplementation((url: string, callback: (data: unknown) => void) => {
        if (url === '/files/upload') {
          capturedCallback = callback
        }
      })

      renderHook(() => usePipelineConfig())

      const config = { max_file_size: 10 * 1024 * 1024 }
      capturedCallback?.(config)

      expect(mockSetFileUploadConfig).toHaveBeenCalledWith(config)
    })
  })
})
