import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CreateFromDSLModalTab, useDSLImport } from './use-dsl-import'

// Mock next/navigation
const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}))

// Mock service hooks
const mockImportDSL = vi.fn()
const mockImportDSLConfirm = vi.fn()

vi.mock('@/service/use-pipeline', () => ({
  useImportPipelineDSL: () => ({
    mutateAsync: mockImportDSL,
  }),
  useImportPipelineDSLConfirm: () => ({
    mutateAsync: mockImportDSLConfirm,
  }),
}))

// Mock plugin dependencies hook
const mockHandleCheckPluginDependencies = vi.fn()

vi.mock('@/app/components/workflow/plugin-dependency/hooks', () => ({
  usePluginDependencies: () => ({
    handleCheckPluginDependencies: mockHandleCheckPluginDependencies,
  }),
}))

// Mock toast context
const mockNotify = vi.fn()

vi.mock('use-context-selector', async () => {
  const actual = await vi.importActual<typeof import('use-context-selector')>('use-context-selector')
  return {
    ...actual,
    useContext: vi.fn(() => ({ notify: mockNotify })),
  }
})

// Test data builders
const createImportDSLResponse = (overrides = {}) => ({
  id: 'import-123',
  status: 'completed' as const,
  pipeline_id: 'pipeline-456',
  dataset_id: 'dataset-789',
  current_dsl_version: '1.0.0',
  imported_dsl_version: '1.0.0',
  ...overrides,
})

// Helper function to create QueryClient wrapper
const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}

describe('useDSLImport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockImportDSL.mockReset()
    mockImportDSLConfirm.mockReset()
    mockPush.mockReset()
    mockNotify.mockReset()
    mockHandleCheckPluginDependencies.mockReset()
  })

  describe('initialization', () => {
    it('should initialize with default values', () => {
      const { result } = renderHook(
        () => useDSLImport({}),
        { wrapper: createWrapper() },
      )

      expect(result.current.currentFile).toBeUndefined()
      expect(result.current.currentTab).toBe(CreateFromDSLModalTab.FROM_FILE)
      expect(result.current.dslUrlValue).toBe('')
      expect(result.current.showConfirmModal).toBe(false)
      expect(result.current.versions).toBeUndefined()
      expect(result.current.buttonDisabled).toBe(true)
      expect(result.current.isConfirming).toBe(false)
    })

    it('should use provided activeTab', () => {
      const { result } = renderHook(
        () => useDSLImport({ activeTab: CreateFromDSLModalTab.FROM_URL }),
        { wrapper: createWrapper() },
      )

      expect(result.current.currentTab).toBe(CreateFromDSLModalTab.FROM_URL)
    })

    it('should use provided dslUrl', () => {
      const { result } = renderHook(
        () => useDSLImport({ dslUrl: 'https://example.com/test.pipeline' }),
        { wrapper: createWrapper() },
      )

      expect(result.current.dslUrlValue).toBe('https://example.com/test.pipeline')
    })
  })

  describe('setCurrentTab', () => {
    it('should update current tab', () => {
      const { result } = renderHook(
        () => useDSLImport({}),
        { wrapper: createWrapper() },
      )

      act(() => {
        result.current.setCurrentTab(CreateFromDSLModalTab.FROM_URL)
      })

      expect(result.current.currentTab).toBe(CreateFromDSLModalTab.FROM_URL)
    })
  })

  describe('setDslUrlValue', () => {
    it('should update DSL URL value', () => {
      const { result } = renderHook(
        () => useDSLImport({}),
        { wrapper: createWrapper() },
      )

      act(() => {
        result.current.setDslUrlValue('https://new-url.com/pipeline')
      })

      expect(result.current.dslUrlValue).toBe('https://new-url.com/pipeline')
    })
  })

  describe('handleFile', () => {
    it('should set file and trigger file reading', async () => {
      const { result } = renderHook(
        () => useDSLImport({}),
        { wrapper: createWrapper() },
      )

      const mockFile = new File(['test content'], 'test.pipeline', { type: 'application/octet-stream' })

      await act(async () => {
        result.current.handleFile(mockFile)
      })

      expect(result.current.currentFile).toBe(mockFile)
      expect(result.current.buttonDisabled).toBe(false)
    })

    it('should clear file when undefined is passed', async () => {
      const { result } = renderHook(
        () => useDSLImport({}),
        { wrapper: createWrapper() },
      )

      const mockFile = new File(['test content'], 'test.pipeline', { type: 'application/octet-stream' })

      // First set a file
      await act(async () => {
        result.current.handleFile(mockFile)
      })

      expect(result.current.currentFile).toBe(mockFile)

      // Then clear it
      await act(async () => {
        result.current.handleFile(undefined)
      })

      expect(result.current.currentFile).toBeUndefined()
      expect(result.current.buttonDisabled).toBe(true)
    })
  })

  describe('buttonDisabled', () => {
    it('should be true when file tab is active and no file is selected', () => {
      const { result } = renderHook(
        () => useDSLImport({ activeTab: CreateFromDSLModalTab.FROM_FILE }),
        { wrapper: createWrapper() },
      )

      expect(result.current.buttonDisabled).toBe(true)
    })

    it('should be false when file tab is active and file is selected', async () => {
      const { result } = renderHook(
        () => useDSLImport({ activeTab: CreateFromDSLModalTab.FROM_FILE }),
        { wrapper: createWrapper() },
      )

      const mockFile = new File(['content'], 'test.pipeline', { type: 'application/octet-stream' })

      await act(async () => {
        result.current.handleFile(mockFile)
      })

      expect(result.current.buttonDisabled).toBe(false)
    })

    it('should be true when URL tab is active and no URL is entered', () => {
      const { result } = renderHook(
        () => useDSLImport({ activeTab: CreateFromDSLModalTab.FROM_URL }),
        { wrapper: createWrapper() },
      )

      expect(result.current.buttonDisabled).toBe(true)
    })

    it('should be false when URL tab is active and URL is entered', () => {
      const { result } = renderHook(
        () => useDSLImport({ activeTab: CreateFromDSLModalTab.FROM_URL, dslUrl: 'https://example.com' }),
        { wrapper: createWrapper() },
      )

      expect(result.current.buttonDisabled).toBe(false)
    })
  })

  describe('handleCreateApp with URL mode', () => {
    it('should call importDSL with URL mode', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      mockImportDSL.mockResolvedValue(createImportDSLResponse())
      mockHandleCheckPluginDependencies.mockResolvedValue(undefined)

      const onSuccess = vi.fn()
      const onClose = vi.fn()

      const { result } = renderHook(
        () => useDSLImport({
          activeTab: CreateFromDSLModalTab.FROM_URL,
          dslUrl: 'https://example.com/test.pipeline',
          onSuccess,
          onClose,
        }),
        { wrapper: createWrapper() },
      )

      await act(async () => {
        result.current.handleCreateApp()
        vi.advanceTimersByTime(400) // Wait for debounce
      })

      await waitFor(() => {
        expect(mockImportDSL).toHaveBeenCalledWith({
          mode: 'yaml-url',
          yaml_url: 'https://example.com/test.pipeline',
        })
      })

      vi.useRealTimers()
    })

    it('should handle successful import with COMPLETED status', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      mockImportDSL.mockResolvedValue(createImportDSLResponse({ status: 'completed' }))
      mockHandleCheckPluginDependencies.mockResolvedValue(undefined)

      const onSuccess = vi.fn()
      const onClose = vi.fn()

      const { result } = renderHook(
        () => useDSLImport({
          activeTab: CreateFromDSLModalTab.FROM_URL,
          dslUrl: 'https://example.com/test.pipeline',
          onSuccess,
          onClose,
        }),
        { wrapper: createWrapper() },
      )

      await act(async () => {
        result.current.handleCreateApp()
        vi.advanceTimersByTime(400)
      })

      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalled()
        expect(onClose).toHaveBeenCalled()
        expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
          type: 'success',
        }))
        expect(mockPush).toHaveBeenCalledWith('/datasets/dataset-789/pipeline')
      })

      vi.useRealTimers()
    })

    it('should handle import with COMPLETED_WITH_WARNINGS status', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      mockImportDSL.mockResolvedValue(createImportDSLResponse({ status: 'completed-with-warnings' }))
      mockHandleCheckPluginDependencies.mockResolvedValue(undefined)

      const onSuccess = vi.fn()
      const onClose = vi.fn()

      const { result } = renderHook(
        () => useDSLImport({
          activeTab: CreateFromDSLModalTab.FROM_URL,
          dslUrl: 'https://example.com/test.pipeline',
          onSuccess,
          onClose,
        }),
        { wrapper: createWrapper() },
      )

      await act(async () => {
        result.current.handleCreateApp()
        vi.advanceTimersByTime(400)
      })

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
          type: 'warning',
        }))
      })

      vi.useRealTimers()
    })

    it('should handle import with PENDING status and show confirm modal', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      mockImportDSL.mockResolvedValue(createImportDSLResponse({
        status: 'pending',
        imported_dsl_version: '0.9.0',
        current_dsl_version: '1.0.0',
      }))

      const onClose = vi.fn()

      const { result } = renderHook(
        () => useDSLImport({
          activeTab: CreateFromDSLModalTab.FROM_URL,
          dslUrl: 'https://example.com/test.pipeline',
          onClose,
        }),
        { wrapper: createWrapper() },
      )

      await act(async () => {
        result.current.handleCreateApp()
        vi.advanceTimersByTime(400)
      })

      await waitFor(() => {
        expect(onClose).toHaveBeenCalled()
      })

      // Wait for setTimeout to show confirm modal
      await act(async () => {
        vi.advanceTimersByTime(400)
      })

      expect(result.current.showConfirmModal).toBe(true)
      expect(result.current.versions).toEqual({
        importedVersion: '0.9.0',
        systemVersion: '1.0.0',
      })

      vi.useRealTimers()
    })

    it('should handle API error (null response)', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      mockImportDSL.mockResolvedValue(null)

      const { result } = renderHook(
        () => useDSLImport({
          activeTab: CreateFromDSLModalTab.FROM_URL,
          dslUrl: 'https://example.com/test.pipeline',
        }),
        { wrapper: createWrapper() },
      )

      await act(async () => {
        result.current.handleCreateApp()
        vi.advanceTimersByTime(400)
      })

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
          type: 'error',
        }))
      })

      vi.useRealTimers()
    })

    it('should handle FAILED status', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      mockImportDSL.mockResolvedValue(createImportDSLResponse({ status: 'failed' }))

      const { result } = renderHook(
        () => useDSLImport({
          activeTab: CreateFromDSLModalTab.FROM_URL,
          dslUrl: 'https://example.com/test.pipeline',
        }),
        { wrapper: createWrapper() },
      )

      await act(async () => {
        result.current.handleCreateApp()
        vi.advanceTimersByTime(400)
      })

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
          type: 'error',
        }))
      })

      vi.useRealTimers()
    })

    it('should check plugin dependencies when pipeline_id is present', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      mockImportDSL.mockResolvedValue(createImportDSLResponse({
        status: 'completed',
        pipeline_id: 'pipeline-123',
      }))
      mockHandleCheckPluginDependencies.mockResolvedValue(undefined)

      const { result } = renderHook(
        () => useDSLImport({
          activeTab: CreateFromDSLModalTab.FROM_URL,
          dslUrl: 'https://example.com/test.pipeline',
        }),
        { wrapper: createWrapper() },
      )

      await act(async () => {
        result.current.handleCreateApp()
        vi.advanceTimersByTime(400)
      })

      await waitFor(() => {
        expect(mockHandleCheckPluginDependencies).toHaveBeenCalledWith('pipeline-123', true)
      })

      vi.useRealTimers()
    })

    it('should not check plugin dependencies when pipeline_id is null', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      mockImportDSL.mockResolvedValue(createImportDSLResponse({
        status: 'completed',
        pipeline_id: null,
      }))

      const { result } = renderHook(
        () => useDSLImport({
          activeTab: CreateFromDSLModalTab.FROM_URL,
          dslUrl: 'https://example.com/test.pipeline',
        }),
        { wrapper: createWrapper() },
      )

      await act(async () => {
        result.current.handleCreateApp()
        vi.advanceTimersByTime(400)
      })

      await waitFor(() => {
        expect(mockHandleCheckPluginDependencies).not.toHaveBeenCalled()
      })

      vi.useRealTimers()
    })

    it('should return early when URL tab is active but no URL is provided', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })

      const { result } = renderHook(
        () => useDSLImport({
          activeTab: CreateFromDSLModalTab.FROM_URL,
          dslUrl: '',
        }),
        { wrapper: createWrapper() },
      )

      await act(async () => {
        result.current.handleCreateApp()
        vi.advanceTimersByTime(400)
      })

      expect(mockImportDSL).not.toHaveBeenCalled()

      vi.useRealTimers()
    })
  })

  describe('handleCreateApp with FILE mode', () => {
    it('should call importDSL with file content mode', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      mockImportDSL.mockResolvedValue(createImportDSLResponse())
      mockHandleCheckPluginDependencies.mockResolvedValue(undefined)

      const { result } = renderHook(
        () => useDSLImport({
          activeTab: CreateFromDSLModalTab.FROM_FILE,
        }),
        { wrapper: createWrapper() },
      )

      const fileContent = 'test yaml content'
      const mockFile = new File([fileContent], 'test.pipeline', { type: 'application/octet-stream' })

      // Set up file and wait for FileReader to complete
      await act(async () => {
        result.current.handleFile(mockFile)
        // Give FileReader time to process
        await new Promise(resolve => setTimeout(resolve, 100))
      })

      // Trigger create
      await act(async () => {
        result.current.handleCreateApp()
        vi.advanceTimersByTime(400)
      })

      await waitFor(() => {
        expect(mockImportDSL).toHaveBeenCalledWith({
          mode: 'yaml-content',
          yaml_content: fileContent,
        })
      })

      vi.useRealTimers()
    })

    it('should return early when file tab is active but no file is selected', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })

      const { result } = renderHook(
        () => useDSLImport({
          activeTab: CreateFromDSLModalTab.FROM_FILE,
        }),
        { wrapper: createWrapper() },
      )

      await act(async () => {
        result.current.handleCreateApp()
        vi.advanceTimersByTime(400)
      })

      expect(mockImportDSL).not.toHaveBeenCalled()

      vi.useRealTimers()
    })
  })

  describe('onDSLConfirm', () => {
    it('should call importDSLConfirm and handle success', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })

      // First, trigger pending status to get importId
      mockImportDSL.mockResolvedValue(createImportDSLResponse({
        id: 'import-123',
        status: 'pending',
      }))

      mockImportDSLConfirm.mockResolvedValue({
        status: 'completed',
        pipeline_id: 'pipeline-456',
        dataset_id: 'dataset-789',
      })

      mockHandleCheckPluginDependencies.mockResolvedValue(undefined)

      const onSuccess = vi.fn()

      const { result } = renderHook(
        () => useDSLImport({
          activeTab: CreateFromDSLModalTab.FROM_URL,
          dslUrl: 'https://example.com/test.pipeline',
          onSuccess,
        }),
        { wrapper: createWrapper() },
      )

      // Trigger pending status
      await act(async () => {
        result.current.handleCreateApp()
        vi.advanceTimersByTime(400)
      })

      // Wait for confirm modal to show
      await act(async () => {
        vi.advanceTimersByTime(400)
      })

      expect(result.current.showConfirmModal).toBe(true)

      // Call onDSLConfirm
      await act(async () => {
        result.current.onDSLConfirm()
      })

      await waitFor(() => {
        expect(mockImportDSLConfirm).toHaveBeenCalledWith('import-123')
        expect(onSuccess).toHaveBeenCalled()
        expect(result.current.showConfirmModal).toBe(false)
        expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
          type: 'success',
        }))
      })

      vi.useRealTimers()
    })

    it('should handle confirm API error', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })

      mockImportDSL.mockResolvedValue(createImportDSLResponse({
        id: 'import-123',
        status: 'pending',
      }))

      mockImportDSLConfirm.mockResolvedValue(null)

      const { result } = renderHook(
        () => useDSLImport({
          activeTab: CreateFromDSLModalTab.FROM_URL,
          dslUrl: 'https://example.com/test.pipeline',
        }),
        { wrapper: createWrapper() },
      )

      // Trigger pending status
      await act(async () => {
        result.current.handleCreateApp()
        vi.advanceTimersByTime(400)
      })

      await act(async () => {
        vi.advanceTimersByTime(400)
      })

      // Call onDSLConfirm
      await act(async () => {
        result.current.onDSLConfirm()
      })

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
          type: 'error',
        }))
      })

      vi.useRealTimers()
    })

    it('should handle confirm with FAILED status', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })

      mockImportDSL.mockResolvedValue(createImportDSLResponse({
        id: 'import-123',
        status: 'pending',
      }))

      mockImportDSLConfirm.mockResolvedValue({
        status: 'failed',
        pipeline_id: 'pipeline-456',
        dataset_id: 'dataset-789',
      })

      const { result } = renderHook(
        () => useDSLImport({
          activeTab: CreateFromDSLModalTab.FROM_URL,
          dslUrl: 'https://example.com/test.pipeline',
        }),
        { wrapper: createWrapper() },
      )

      // Trigger pending status
      await act(async () => {
        result.current.handleCreateApp()
        vi.advanceTimersByTime(400)
      })

      await act(async () => {
        vi.advanceTimersByTime(400)
      })

      // Call onDSLConfirm
      await act(async () => {
        result.current.onDSLConfirm()
      })

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
          type: 'error',
        }))
      })

      vi.useRealTimers()
    })

    it('should return early when importId is not set', async () => {
      const { result } = renderHook(
        () => useDSLImport({
          activeTab: CreateFromDSLModalTab.FROM_URL,
          dslUrl: 'https://example.com/test.pipeline',
        }),
        { wrapper: createWrapper() },
      )

      // Call onDSLConfirm without triggering pending status
      await act(async () => {
        result.current.onDSLConfirm()
      })

      expect(mockImportDSLConfirm).not.toHaveBeenCalled()
    })

    it('should check plugin dependencies on confirm success', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })

      mockImportDSL.mockResolvedValue(createImportDSLResponse({
        id: 'import-123',
        status: 'pending',
      }))

      mockImportDSLConfirm.mockResolvedValue({
        status: 'completed',
        pipeline_id: 'pipeline-789',
        dataset_id: 'dataset-789',
      })

      mockHandleCheckPluginDependencies.mockResolvedValue(undefined)

      const { result } = renderHook(
        () => useDSLImport({
          activeTab: CreateFromDSLModalTab.FROM_URL,
          dslUrl: 'https://example.com/test.pipeline',
        }),
        { wrapper: createWrapper() },
      )

      // Trigger pending status
      await act(async () => {
        result.current.handleCreateApp()
        vi.advanceTimersByTime(400)
      })

      await act(async () => {
        vi.advanceTimersByTime(400)
      })

      // Call onDSLConfirm
      await act(async () => {
        result.current.onDSLConfirm()
      })

      await waitFor(() => {
        expect(mockHandleCheckPluginDependencies).toHaveBeenCalledWith('pipeline-789', true)
      })

      vi.useRealTimers()
    })

    it('should set isConfirming during confirm process', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })

      let resolveConfirm: (value: unknown) => void
      mockImportDSL.mockResolvedValue(createImportDSLResponse({
        id: 'import-123',
        status: 'pending',
      }))

      mockImportDSLConfirm.mockImplementation(() => new Promise((resolve) => {
        resolveConfirm = resolve
      }))

      const { result } = renderHook(
        () => useDSLImport({
          activeTab: CreateFromDSLModalTab.FROM_URL,
          dslUrl: 'https://example.com/test.pipeline',
        }),
        { wrapper: createWrapper() },
      )

      // Trigger pending status
      await act(async () => {
        result.current.handleCreateApp()
        vi.advanceTimersByTime(400)
      })

      await act(async () => {
        vi.advanceTimersByTime(400)
      })

      expect(result.current.isConfirming).toBe(false)

      // Start confirm
      let confirmPromise: Promise<void>
      act(() => {
        confirmPromise = result.current.onDSLConfirm()
      })

      await waitFor(() => {
        expect(result.current.isConfirming).toBe(true)
      })

      // Resolve confirm
      await act(async () => {
        resolveConfirm!({
          status: 'completed',
          pipeline_id: 'pipeline-789',
          dataset_id: 'dataset-789',
        })
      })

      await confirmPromise!

      expect(result.current.isConfirming).toBe(false)

      vi.useRealTimers()
    })
  })

  describe('handleCancelConfirm', () => {
    it('should close confirm modal', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })

      mockImportDSL.mockResolvedValue(createImportDSLResponse({
        id: 'import-123',
        status: 'pending',
      }))

      const { result } = renderHook(
        () => useDSLImport({
          activeTab: CreateFromDSLModalTab.FROM_URL,
          dslUrl: 'https://example.com/test.pipeline',
        }),
        { wrapper: createWrapper() },
      )

      // Trigger pending status to show confirm modal
      await act(async () => {
        result.current.handleCreateApp()
        vi.advanceTimersByTime(400)
      })

      await act(async () => {
        vi.advanceTimersByTime(400)
      })

      expect(result.current.showConfirmModal).toBe(true)

      // Cancel confirm
      act(() => {
        result.current.handleCancelConfirm()
      })

      expect(result.current.showConfirmModal).toBe(false)

      vi.useRealTimers()
    })
  })

  describe('duplicate submission prevention', () => {
    it('should prevent duplicate submissions while creating', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })

      let resolveImport: (value: unknown) => void
      mockImportDSL.mockImplementation(() => new Promise((resolve) => {
        resolveImport = resolve
      }))

      const { result } = renderHook(
        () => useDSLImport({
          activeTab: CreateFromDSLModalTab.FROM_URL,
          dslUrl: 'https://example.com/test.pipeline',
        }),
        { wrapper: createWrapper() },
      )

      // First call
      await act(async () => {
        result.current.handleCreateApp()
        vi.advanceTimersByTime(400)
      })

      // Second call should be ignored
      await act(async () => {
        result.current.handleCreateApp()
        vi.advanceTimersByTime(400)
      })

      // Third call should be ignored
      await act(async () => {
        result.current.handleCreateApp()
        vi.advanceTimersByTime(400)
      })

      // Only one call should be made
      expect(mockImportDSL).toHaveBeenCalledTimes(1)

      // Resolve the first call
      await act(async () => {
        resolveImport!(createImportDSLResponse())
      })

      vi.useRealTimers()
    })
  })

  describe('file reading', () => {
    it('should read file content using FileReader', async () => {
      const { result } = renderHook(
        () => useDSLImport({ activeTab: CreateFromDSLModalTab.FROM_FILE }),
        { wrapper: createWrapper() },
      )

      const fileContent = 'yaml content here'
      const mockFile = new File([fileContent], 'test.pipeline', { type: 'application/octet-stream' })

      await act(async () => {
        result.current.handleFile(mockFile)
      })

      expect(result.current.currentFile).toBe(mockFile)
    })

    it('should clear file content when file is removed', async () => {
      const { result } = renderHook(
        () => useDSLImport({ activeTab: CreateFromDSLModalTab.FROM_FILE }),
        { wrapper: createWrapper() },
      )

      const mockFile = new File(['content'], 'test.pipeline', { type: 'application/octet-stream' })

      // Set file
      await act(async () => {
        result.current.handleFile(mockFile)
      })

      // Clear file
      await act(async () => {
        result.current.handleFile(undefined)
      })

      expect(result.current.currentFile).toBeUndefined()
    })
  })

  describe('navigation after import', () => {
    it('should navigate to pipeline page after successful import', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      mockImportDSL.mockResolvedValue(createImportDSLResponse({
        status: 'completed',
        dataset_id: 'test-dataset-id',
      }))
      mockHandleCheckPluginDependencies.mockResolvedValue(undefined)

      const { result } = renderHook(
        () => useDSLImport({
          activeTab: CreateFromDSLModalTab.FROM_URL,
          dslUrl: 'https://example.com/test.pipeline',
        }),
        { wrapper: createWrapper() },
      )

      await act(async () => {
        result.current.handleCreateApp()
        vi.advanceTimersByTime(400)
      })

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/datasets/test-dataset-id/pipeline')
      })

      vi.useRealTimers()
    })

    it('should navigate to pipeline page after confirm success', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })

      mockImportDSL.mockResolvedValue(createImportDSLResponse({
        id: 'import-123',
        status: 'pending',
      }))

      mockImportDSLConfirm.mockResolvedValue({
        status: 'completed',
        pipeline_id: 'pipeline-456',
        dataset_id: 'confirm-dataset-id',
      })

      mockHandleCheckPluginDependencies.mockResolvedValue(undefined)

      const { result } = renderHook(
        () => useDSLImport({
          activeTab: CreateFromDSLModalTab.FROM_URL,
          dslUrl: 'https://example.com/test.pipeline',
        }),
        { wrapper: createWrapper() },
      )

      // Trigger pending status
      await act(async () => {
        result.current.handleCreateApp()
        vi.advanceTimersByTime(400)
      })

      await act(async () => {
        vi.advanceTimersByTime(400)
      })

      // Call onDSLConfirm
      await act(async () => {
        result.current.onDSLConfirm()
      })

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/datasets/confirm-dataset-id/pipeline')
      })

      vi.useRealTimers()
    })
  })

  describe('enum export', () => {
    it('should export CreateFromDSLModalTab enum with correct values', () => {
      expect(CreateFromDSLModalTab.FROM_FILE).toBe('from-file')
      expect(CreateFromDSLModalTab.FROM_URL).toBe('from-url')
    })
  })
})
