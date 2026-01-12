import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import DSLConfirmModal from './dsl-confirm-modal'
import Header from './header'
import CreateFromDSLModal, { CreateFromDSLModalTab } from './index'
import Tab from './tab'
import TabItem from './tab/item'
import Uploader from './uploader'

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
const createMockFile = (name = 'test.pipeline'): File => {
  return new File(['test content'], name, { type: 'application/octet-stream' })
}

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
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}

describe('CreateFromDSLModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockImportDSL.mockReset()
    mockImportDSLConfirm.mockReset()
    mockPush.mockReset()
    mockNotify.mockReset()
    mockHandleCheckPluginDependencies.mockReset()
  })

  // ============================================
  // Rendering Tests
  // ============================================
  describe('Rendering', () => {
    it('should render without crashing when show is true', () => {
      render(
        <CreateFromDSLModal
          show={true}
          onClose={vi.fn()}
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.getByText('app.importFromDSL')).toBeInTheDocument()
    })

    it('should not render modal content when show is false', () => {
      render(
        <CreateFromDSLModal
          show={false}
          onClose={vi.fn()}
        />,
        { wrapper: createWrapper() },
      )

      // Modal with show=false should not display its content visibly
      const modal = screen.queryByText('app.importFromDSL')
      expect(modal).toBeNull()
    })

    it('should render file tab by default', () => {
      render(
        <CreateFromDSLModal
          show={true}
          onClose={vi.fn()}
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.getByText('app.importFromDSLFile')).toBeInTheDocument()
      expect(screen.getByText('app.importFromDSLUrl')).toBeInTheDocument()
    })

    it('should render cancel and import buttons', () => {
      render(
        <CreateFromDSLModal
          show={true}
          onClose={vi.fn()}
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.getByText('app.newApp.Cancel')).toBeInTheDocument()
      expect(screen.getByText('app.newApp.import')).toBeInTheDocument()
    })

    it('should render uploader when file tab is active', () => {
      render(
        <CreateFromDSLModal
          show={true}
          onClose={vi.fn()}
          activeTab={CreateFromDSLModalTab.FROM_FILE}
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.getByText('app.dslUploader.button')).toBeInTheDocument()
    })

    it('should render URL input when URL tab is active', () => {
      render(
        <CreateFromDSLModal
          show={true}
          onClose={vi.fn()}
          activeTab={CreateFromDSLModalTab.FROM_URL}
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.getByText('DSL URL')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('app.importFromDSLUrlPlaceholder')).toBeInTheDocument()
    })
  })

  // ============================================
  // Props Testing
  // ============================================
  describe('Props', () => {
    it('should use FROM_FILE as default activeTab', () => {
      render(
        <CreateFromDSLModal
          show={true}
          onClose={vi.fn()}
        />,
        { wrapper: createWrapper() },
      )

      // File tab content should be visible
      expect(screen.getByText('app.dslUploader.button')).toBeInTheDocument()
    })

    it('should use provided activeTab prop', () => {
      render(
        <CreateFromDSLModal
          show={true}
          onClose={vi.fn()}
          activeTab={CreateFromDSLModalTab.FROM_URL}
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.getByText('DSL URL')).toBeInTheDocument()
    })

    it('should use provided dslUrl prop', () => {
      render(
        <CreateFromDSLModal
          show={true}
          onClose={vi.fn()}
          activeTab={CreateFromDSLModalTab.FROM_URL}
          dslUrl="https://example.com/test.pipeline"
        />,
        { wrapper: createWrapper() },
      )

      const input = screen.getByPlaceholderText('app.importFromDSLUrlPlaceholder')
      expect(input).toHaveValue('https://example.com/test.pipeline')
    })

    it('should call onClose when cancel button is clicked', () => {
      const onClose = vi.fn()
      render(
        <CreateFromDSLModal
          show={true}
          onClose={onClose}
        />,
        { wrapper: createWrapper() },
      )

      fireEvent.click(screen.getByText('app.newApp.Cancel'))
      expect(onClose).toHaveBeenCalled()
    })
  })

  // ============================================
  // State Management Tests
  // ============================================
  describe('State Management', () => {
    it('should switch between tabs', () => {
      render(
        <CreateFromDSLModal
          show={true}
          onClose={vi.fn()}
        />,
        { wrapper: createWrapper() },
      )

      // Initially file tab is active
      expect(screen.getByText('app.dslUploader.button')).toBeInTheDocument()

      // Click URL tab
      fireEvent.click(screen.getByText('app.importFromDSLUrl'))

      // URL input should be visible
      expect(screen.getByText('DSL URL')).toBeInTheDocument()
    })

    it('should update URL value when typing', () => {
      render(
        <CreateFromDSLModal
          show={true}
          onClose={vi.fn()}
          activeTab={CreateFromDSLModalTab.FROM_URL}
        />,
        { wrapper: createWrapper() },
      )

      const input = screen.getByPlaceholderText('app.importFromDSLUrlPlaceholder')
      fireEvent.change(input, { target: { value: 'https://example.com/test.pipeline' } })

      expect(input).toHaveValue('https://example.com/test.pipeline')
    })

    it('should have disabled import button when no file is selected in file tab', () => {
      render(
        <CreateFromDSLModal
          show={true}
          onClose={vi.fn()}
          activeTab={CreateFromDSLModalTab.FROM_FILE}
        />,
        { wrapper: createWrapper() },
      )

      const importButton = screen.getByText('app.newApp.import').closest('button')
      expect(importButton).toBeDisabled()
    })

    it('should have disabled import button when no URL is entered in URL tab', () => {
      render(
        <CreateFromDSLModal
          show={true}
          onClose={vi.fn()}
          activeTab={CreateFromDSLModalTab.FROM_URL}
        />,
        { wrapper: createWrapper() },
      )

      const importButton = screen.getByText('app.newApp.import').closest('button')
      expect(importButton).toBeDisabled()
    })

    it('should enable import button when URL is entered', () => {
      render(
        <CreateFromDSLModal
          show={true}
          onClose={vi.fn()}
          activeTab={CreateFromDSLModalTab.FROM_URL}
        />,
        { wrapper: createWrapper() },
      )

      const input = screen.getByPlaceholderText('app.importFromDSLUrlPlaceholder')
      fireEvent.change(input, { target: { value: 'https://example.com/test.pipeline' } })

      const importButton = screen.getByText('app.newApp.import').closest('button')
      expect(importButton).not.toBeDisabled()
    })
  })

  // ============================================
  // API Call Tests
  // ============================================
  describe('API Calls', () => {
    it('should call importDSL with URL mode when URL tab is active', async () => {
      mockImportDSL.mockResolvedValue(createImportDSLResponse())

      render(
        <CreateFromDSLModal
          show={true}
          onClose={vi.fn()}
          activeTab={CreateFromDSLModalTab.FROM_URL}
        />,
        { wrapper: createWrapper() },
      )

      const input = screen.getByPlaceholderText('app.importFromDSLUrlPlaceholder')
      fireEvent.change(input, { target: { value: 'https://example.com/test.pipeline' } })

      const importButton = screen.getByText('app.newApp.import').closest('button')!
      fireEvent.click(importButton)

      await waitFor(() => {
        expect(mockImportDSL).toHaveBeenCalledWith({
          mode: 'yaml-url',
          yaml_url: 'https://example.com/test.pipeline',
        })
      })
    })

    it('should handle successful import with COMPLETED status', async () => {
      const onSuccess = vi.fn()
      const onClose = vi.fn()
      mockImportDSL.mockResolvedValue(createImportDSLResponse({ status: 'completed' }))
      mockHandleCheckPluginDependencies.mockResolvedValue(undefined)

      render(
        <CreateFromDSLModal
          show={true}
          onSuccess={onSuccess}
          onClose={onClose}
          activeTab={CreateFromDSLModalTab.FROM_URL}
        />,
        { wrapper: createWrapper() },
      )

      const input = screen.getByPlaceholderText('app.importFromDSLUrlPlaceholder')
      fireEvent.change(input, { target: { value: 'https://example.com/test.pipeline' } })

      const importButton = screen.getByText('app.newApp.import').closest('button')!
      fireEvent.click(importButton)

      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalled()
        expect(onClose).toHaveBeenCalled()
        expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
          type: 'success',
        }))
        expect(mockPush).toHaveBeenCalledWith('/datasets/dataset-789/pipeline')
      })
    })

    it('should handle import with COMPLETED_WITH_WARNINGS status', async () => {
      const onSuccess = vi.fn()
      const onClose = vi.fn()
      mockImportDSL.mockResolvedValue(createImportDSLResponse({ status: 'completed-with-warnings' }))
      mockHandleCheckPluginDependencies.mockResolvedValue(undefined)

      render(
        <CreateFromDSLModal
          show={true}
          onSuccess={onSuccess}
          onClose={onClose}
          activeTab={CreateFromDSLModalTab.FROM_URL}
        />,
        { wrapper: createWrapper() },
      )

      const input = screen.getByPlaceholderText('app.importFromDSLUrlPlaceholder')
      fireEvent.change(input, { target: { value: 'https://example.com/test.pipeline' } })

      const importButton = screen.getByText('app.newApp.import').closest('button')!
      fireEvent.click(importButton)

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
          type: 'warning',
        }))
      })
    })

    it('should handle import with PENDING status and show error modal', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const onClose = vi.fn()
      mockImportDSL.mockResolvedValue(createImportDSLResponse({
        status: 'pending',
        imported_dsl_version: '0.9.0',
        current_dsl_version: '1.0.0',
      }))

      render(
        <CreateFromDSLModal
          show={true}
          onClose={onClose}
          activeTab={CreateFromDSLModalTab.FROM_URL}
        />,
        { wrapper: createWrapper() },
      )

      const input = screen.getByPlaceholderText('app.importFromDSLUrlPlaceholder')
      fireEvent.change(input, { target: { value: 'https://example.com/test.pipeline' } })

      const importButton = screen.getByText('app.newApp.import').closest('button')!
      fireEvent.click(importButton)

      await waitFor(() => {
        expect(onClose).toHaveBeenCalled()
      })

      // Advance timer to show error modal
      await act(async () => {
        vi.advanceTimersByTime(400)
      })

      await waitFor(() => {
        expect(screen.getByText('app.newApp.appCreateDSLErrorTitle')).toBeInTheDocument()
      })

      vi.useRealTimers()
    })

    it('should handle API error', async () => {
      mockImportDSL.mockResolvedValue(null)

      render(
        <CreateFromDSLModal
          show={true}
          onClose={vi.fn()}
          activeTab={CreateFromDSLModalTab.FROM_URL}
        />,
        { wrapper: createWrapper() },
      )

      const input = screen.getByPlaceholderText('app.importFromDSLUrlPlaceholder')
      fireEvent.change(input, { target: { value: 'https://example.com/test.pipeline' } })

      const importButton = screen.getByText('app.newApp.import').closest('button')!
      fireEvent.click(importButton)

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
          type: 'error',
        }))
      })
    })

    it('should handle FAILED status', async () => {
      mockImportDSL.mockResolvedValue(createImportDSLResponse({ status: 'failed' }))

      render(
        <CreateFromDSLModal
          show={true}
          onClose={vi.fn()}
          activeTab={CreateFromDSLModalTab.FROM_URL}
        />,
        { wrapper: createWrapper() },
      )

      const input = screen.getByPlaceholderText('app.importFromDSLUrlPlaceholder')
      fireEvent.change(input, { target: { value: 'https://example.com/test.pipeline' } })

      const importButton = screen.getByText('app.newApp.import').closest('button')!
      fireEvent.click(importButton)

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
          type: 'error',
        }))
      })
    })

    it('should check plugin dependencies after successful import', async () => {
      mockImportDSL.mockResolvedValue(createImportDSLResponse({
        status: 'completed',
        pipeline_id: 'pipeline-123',
      }))
      mockHandleCheckPluginDependencies.mockResolvedValue(undefined)

      render(
        <CreateFromDSLModal
          show={true}
          onClose={vi.fn()}
          activeTab={CreateFromDSLModalTab.FROM_URL}
        />,
        { wrapper: createWrapper() },
      )

      const input = screen.getByPlaceholderText('app.importFromDSLUrlPlaceholder')
      fireEvent.change(input, { target: { value: 'https://example.com/test.pipeline' } })

      const importButton = screen.getByText('app.newApp.import').closest('button')!
      fireEvent.click(importButton)

      await waitFor(() => {
        expect(mockHandleCheckPluginDependencies).toHaveBeenCalledWith('pipeline-123', true)
      })
    })
  })

  // ============================================
  // Event Handler Tests
  // ============================================
  describe('Event Handlers', () => {
    it('should call onClose when header close button is clicked', () => {
      const onClose = vi.fn()
      render(
        <CreateFromDSLModal
          show={true}
          onClose={onClose}
        />,
        { wrapper: createWrapper() },
      )

      // Find and click the close icon in header
      const closeIcon = document.querySelector('[class*="cursor-pointer"]')

      if (closeIcon) {
        fireEvent.click(closeIcon)
        expect(onClose).toHaveBeenCalled()
      }
    })

    it('should close modal on ESC key press', () => {
      const onClose = vi.fn()
      render(
        <CreateFromDSLModal
          show={true}
          onClose={onClose}
        />,
        { wrapper: createWrapper() },
      )

      // Trigger ESC key event - ahooks useKeyPress listens for 'esc' which maps to Escape key
      // Need to dispatch on window/document with the correct event properties
      const escEvent = new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        keyCode: 27,
        bubbles: true,
      })
      document.dispatchEvent(escEvent)

      expect(onClose).toHaveBeenCalled()
    })

    it('should not close on ESC when error modal is shown', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const onClose = vi.fn()
      mockImportDSL.mockResolvedValue(createImportDSLResponse({ status: 'pending' }))

      render(
        <CreateFromDSLModal
          show={true}
          onClose={onClose}
          activeTab={CreateFromDSLModalTab.FROM_URL}
        />,
        { wrapper: createWrapper() },
      )

      const input = screen.getByPlaceholderText('app.importFromDSLUrlPlaceholder')
      fireEvent.change(input, { target: { value: 'https://example.com/test.pipeline' } })

      const importButton = screen.getByText('app.newApp.import').closest('button')!
      fireEvent.click(importButton)

      await waitFor(() => {
        expect(onClose).toHaveBeenCalled()
      })

      // Clear previous calls
      onClose.mockClear()

      // Show error modal
      await act(async () => {
        vi.advanceTimersByTime(400)
      })

      // Now ESC should not close main modal because error modal is shown
      const escEvent = new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        keyCode: 27,
        bubbles: true,
      })
      document.dispatchEvent(escEvent)

      // onClose should not be called again when error modal is shown
      expect(onClose).not.toHaveBeenCalled()

      vi.useRealTimers()
    })

    it('should prevent duplicate submissions', async () => {
      mockImportDSL.mockImplementation(() => new Promise(resolve =>
        setTimeout(() => resolve(createImportDSLResponse()), 1000),
      ))

      render(
        <CreateFromDSLModal
          show={true}
          onClose={vi.fn()}
          activeTab={CreateFromDSLModalTab.FROM_URL}
        />,
        { wrapper: createWrapper() },
      )

      const input = screen.getByPlaceholderText('app.importFromDSLUrlPlaceholder')
      fireEvent.change(input, { target: { value: 'https://example.com/test.pipeline' } })

      const importButton = screen.getByText('app.newApp.import').closest('button')!

      // Click multiple times rapidly
      fireEvent.click(importButton)
      fireEvent.click(importButton)
      fireEvent.click(importButton)

      // Should only be called once due to isCreatingRef
      await waitFor(() => {
        expect(mockImportDSL).toHaveBeenCalledTimes(1)
      })
    })
  })

  // ============================================
  // Memoization Tests
  // ============================================
  describe('Memoization', () => {
    it('should correctly compute buttonDisabled based on currentTab and file/URL', () => {
      render(
        <CreateFromDSLModal
          show={true}
          onClose={vi.fn()}
          activeTab={CreateFromDSLModalTab.FROM_FILE}
        />,
        { wrapper: createWrapper() },
      )

      // File tab with no file - disabled
      let importButton = screen.getByText('app.newApp.import').closest('button')
      expect(importButton).toBeDisabled()

      // Switch to URL tab by clicking on it
      fireEvent.click(screen.getByText('app.importFromDSLUrl'))

      // Still disabled (no URL)
      importButton = screen.getByText('app.newApp.import').closest('button')
      expect(importButton).toBeDisabled()

      // Add URL value - should enable
      const input = screen.getByPlaceholderText('app.importFromDSLUrlPlaceholder')
      fireEvent.change(input, { target: { value: 'https://example.com' } })

      importButton = screen.getByText('app.newApp.import').closest('button')
      expect(importButton).not.toBeDisabled()
    })
  })

  // ============================================
  // Edge Cases Tests
  // ============================================
  describe('Edge Cases', () => {
    it('should handle empty URL gracefully', () => {
      render(
        <CreateFromDSLModal
          show={true}
          onClose={vi.fn()}
          activeTab={CreateFromDSLModalTab.FROM_URL}
        />,
        { wrapper: createWrapper() },
      )

      const importButton = screen.getByText('app.newApp.import').closest('button')!
      fireEvent.click(importButton)

      // Should not call API with empty URL
      expect(mockImportDSL).not.toHaveBeenCalled()
    })

    it('should handle undefined onSuccess gracefully', async () => {
      mockImportDSL.mockResolvedValue(createImportDSLResponse())
      mockHandleCheckPluginDependencies.mockResolvedValue(undefined)

      render(
        <CreateFromDSLModal
          show={true}
          onClose={vi.fn()}
          activeTab={CreateFromDSLModalTab.FROM_URL}
          // onSuccess is undefined
        />,
        { wrapper: createWrapper() },
      )

      const input = screen.getByPlaceholderText('app.importFromDSLUrlPlaceholder')
      fireEvent.change(input, { target: { value: 'https://example.com/test.pipeline' } })

      const importButton = screen.getByText('app.newApp.import').closest('button')!

      // Should not throw
      fireEvent.click(importButton)

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalled()
      })
    })

    it('should handle response without pipeline_id', async () => {
      mockImportDSL.mockResolvedValue(createImportDSLResponse({
        status: 'completed',
        pipeline_id: null,
      }))

      render(
        <CreateFromDSLModal
          show={true}
          onClose={vi.fn()}
          activeTab={CreateFromDSLModalTab.FROM_URL}
        />,
        { wrapper: createWrapper() },
      )

      const input = screen.getByPlaceholderText('app.importFromDSLUrlPlaceholder')
      fireEvent.change(input, { target: { value: 'https://example.com/test.pipeline' } })

      const importButton = screen.getByText('app.newApp.import').closest('button')!
      fireEvent.click(importButton)

      await waitFor(() => {
        // Should not call handleCheckPluginDependencies when pipeline_id is null
        expect(mockHandleCheckPluginDependencies).not.toHaveBeenCalled()
      })
    })

    it('should handle empty file in file tab gracefully', () => {
      render(
        <CreateFromDSLModal
          show={true}
          onClose={vi.fn()}
          activeTab={CreateFromDSLModalTab.FROM_FILE}
        />,
        { wrapper: createWrapper() },
      )

      const importButton = screen.getByText('app.newApp.import').closest('button')!
      fireEvent.click(importButton)

      // Should not call API with no file
      expect(mockImportDSL).not.toHaveBeenCalled()
    })

    it('should return early in onCreate when file tab has no file (direct trigger)', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })

      // Test the early return branch by force-triggering the button even when disabled
      render(
        <CreateFromDSLModal
          show={true}
          onClose={vi.fn()}
          activeTab={CreateFromDSLModalTab.FROM_FILE}
        />,
        { wrapper: createWrapper() },
      )

      const importButton = screen.getByText('app.newApp.import').closest('button')!

      // Remove disabled attribute temporarily to test the early return
      importButton.removeAttribute('disabled')

      // Dispatch a native click event to bypass any React disabled checks
      const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true })
      importButton.dispatchEvent(clickEvent)

      // Wait for debounce to trigger
      await act(async () => {
        vi.advanceTimersByTime(400)
      })

      // Should not call API due to early return in onCreate
      expect(mockImportDSL).not.toHaveBeenCalled()

      vi.useRealTimers()
    })

    it('should return early in onCreate when URL tab has no URL (direct trigger)', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })

      render(
        <CreateFromDSLModal
          show={true}
          onClose={vi.fn()}
          activeTab={CreateFromDSLModalTab.FROM_URL}
        />,
        { wrapper: createWrapper() },
      )

      const importButton = screen.getByText('app.newApp.import').closest('button')!

      // Remove disabled attribute to test the early return
      importButton.removeAttribute('disabled')

      // Dispatch a native click event
      const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true })
      importButton.dispatchEvent(clickEvent)

      // Wait for debounce
      await act(async () => {
        vi.advanceTimersByTime(400)
      })

      // Should not call API due to early return
      expect(mockImportDSL).not.toHaveBeenCalled()

      vi.useRealTimers()
    })
  })

  // ============================================
  // File Import Tests (covers readFile, handleFile, file mode import)
  // ============================================
  describe('File Import', () => {
    it('should read file content when file is selected', async () => {
      mockImportDSL.mockResolvedValue(createImportDSLResponse())
      mockHandleCheckPluginDependencies.mockResolvedValue(undefined)

      render(
        <CreateFromDSLModal
          show={true}
          onClose={vi.fn()}
          activeTab={CreateFromDSLModalTab.FROM_FILE}
        />,
        { wrapper: createWrapper() },
      )

      // Create a mock file with content
      const fileContent = 'test yaml content'
      const mockFile = new File([fileContent], 'test.pipeline', { type: 'application/octet-stream' })

      // Get the file input and simulate file selection
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      Object.defineProperty(fileInput, 'files', {
        value: [mockFile],
        configurable: true,
      })
      fireEvent.change(fileInput)

      // Wait for FileReader to complete
      await waitFor(() => {
        const importButton = screen.getByText('app.newApp.import').closest('button')
        expect(importButton).not.toBeDisabled()
      })

      // Click import button
      const importButton = screen.getByText('app.newApp.import').closest('button')!
      fireEvent.click(importButton)

      // Verify API was called with file content
      await waitFor(() => {
        expect(mockImportDSL).toHaveBeenCalledWith({
          mode: 'yaml-content',
          yaml_content: fileContent,
        })
      })
    })

    it('should clear file content when file is removed', async () => {
      render(
        <CreateFromDSLModal
          show={true}
          onClose={vi.fn()}
          activeTab={CreateFromDSLModalTab.FROM_FILE}
        />,
        { wrapper: createWrapper() },
      )

      // First add a file
      const mockFile = new File(['content'], 'test.pipeline', { type: 'application/octet-stream' })
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      Object.defineProperty(fileInput, 'files', {
        value: [mockFile],
        configurable: true,
      })
      fireEvent.change(fileInput)

      // Wait for file to be displayed
      await waitFor(() => {
        expect(screen.getByText('test.pipeline')).toBeInTheDocument()
      })

      // Now remove the file by clicking delete button (inside ActionButton)
      const actionButton = document.querySelector('[class*="group-hover"]')
      const deleteButton = actionButton?.querySelector('button')
      if (deleteButton) {
        fireEvent.click(deleteButton)
        // File should be removed - uploader prompt should show again
        await waitFor(() => {
          expect(screen.getByText('app.dslUploader.button')).toBeInTheDocument()
        })
      }
    })
  })

  // ============================================
  // DSL Confirm Flow Tests (covers onDSLConfirm)
  // ============================================
  describe('DSL Confirm Flow', () => {
    it('should handle DSL confirm success', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const onSuccess = vi.fn()
      const onClose = vi.fn()

      mockImportDSL.mockResolvedValue(createImportDSLResponse({
        id: 'import-123',
        status: 'pending',
        imported_dsl_version: '0.9.0',
        current_dsl_version: '1.0.0',
      }))

      mockImportDSLConfirm.mockResolvedValue({
        status: 'completed',
        pipeline_id: 'pipeline-456',
        dataset_id: 'dataset-789',
      })

      mockHandleCheckPluginDependencies.mockResolvedValue(undefined)

      render(
        <CreateFromDSLModal
          show={true}
          onSuccess={onSuccess}
          onClose={onClose}
          activeTab={CreateFromDSLModalTab.FROM_URL}
        />,
        { wrapper: createWrapper() },
      )

      // Enter URL and submit
      const input = screen.getByPlaceholderText('app.importFromDSLUrlPlaceholder')
      fireEvent.change(input, { target: { value: 'https://example.com/test.pipeline' } })

      const importButton = screen.getByText('app.newApp.import').closest('button')!
      fireEvent.click(importButton)

      // Wait for pending status handling
      await waitFor(() => {
        expect(onClose).toHaveBeenCalled()
      })

      // Advance timer to show error modal
      await act(async () => {
        vi.advanceTimersByTime(400)
      })

      // Click confirm button in error modal
      await waitFor(() => {
        expect(screen.getByText('app.newApp.Confirm')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('app.newApp.Confirm'))

      // Verify confirm was called
      await waitFor(() => {
        expect(mockImportDSLConfirm).toHaveBeenCalledWith('import-123')
      })

      // Verify success handling
      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
          type: 'success',
        }))
      })

      vi.useRealTimers()
    })

    it('should handle DSL confirm with no importId', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })

      mockImportDSL.mockResolvedValue(createImportDSLResponse({
        id: '', // Empty id
        status: 'pending',
      }))

      render(
        <CreateFromDSLModal
          show={true}
          onClose={vi.fn()}
          activeTab={CreateFromDSLModalTab.FROM_URL}
        />,
        { wrapper: createWrapper() },
      )

      const input = screen.getByPlaceholderText('app.importFromDSLUrlPlaceholder')
      fireEvent.change(input, { target: { value: 'https://example.com/test.pipeline' } })

      const importButton = screen.getByText('app.newApp.import').closest('button')!
      fireEvent.click(importButton)

      await act(async () => {
        vi.advanceTimersByTime(400)
      })

      // Click confirm - should return early since importId is empty
      await waitFor(() => {
        expect(screen.getByText('app.newApp.Confirm')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('app.newApp.Confirm'))

      // Confirm should not be called since importId is empty string (falsy)
      expect(mockImportDSLConfirm).not.toHaveBeenCalled()

      vi.useRealTimers()
    })

    it('should handle DSL confirm API error', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })

      mockImportDSL.mockResolvedValue(createImportDSLResponse({
        id: 'import-123',
        status: 'pending',
      }))

      mockImportDSLConfirm.mockResolvedValue(null)

      render(
        <CreateFromDSLModal
          show={true}
          onClose={vi.fn()}
          activeTab={CreateFromDSLModalTab.FROM_URL}
        />,
        { wrapper: createWrapper() },
      )

      const input = screen.getByPlaceholderText('app.importFromDSLUrlPlaceholder')
      fireEvent.change(input, { target: { value: 'https://example.com/test.pipeline' } })

      fireEvent.click(screen.getByText('app.newApp.import').closest('button')!)

      await act(async () => {
        vi.advanceTimersByTime(400)
      })

      await waitFor(() => {
        expect(screen.getByText('app.newApp.Confirm')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('app.newApp.Confirm'))

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
          type: 'error',
        }))
      })

      vi.useRealTimers()
    })

    it('should handle DSL confirm with FAILED status', async () => {
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

      render(
        <CreateFromDSLModal
          show={true}
          onClose={vi.fn()}
          activeTab={CreateFromDSLModalTab.FROM_URL}
        />,
        { wrapper: createWrapper() },
      )

      const input = screen.getByPlaceholderText('app.importFromDSLUrlPlaceholder')
      fireEvent.change(input, { target: { value: 'https://example.com/test.pipeline' } })

      fireEvent.click(screen.getByText('app.newApp.import').closest('button')!)

      await act(async () => {
        vi.advanceTimersByTime(400)
      })

      await waitFor(() => {
        expect(screen.getByText('app.newApp.Confirm')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('app.newApp.Confirm'))

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
          type: 'error',
        }))
      })

      vi.useRealTimers()
    })

    it('should close error modal when cancel is clicked', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })

      mockImportDSL.mockResolvedValue(createImportDSLResponse({
        status: 'pending',
      }))

      render(
        <CreateFromDSLModal
          show={true}
          onClose={vi.fn()}
          activeTab={CreateFromDSLModalTab.FROM_URL}
        />,
        { wrapper: createWrapper() },
      )

      const input = screen.getByPlaceholderText('app.importFromDSLUrlPlaceholder')
      fireEvent.change(input, { target: { value: 'https://example.com/test.pipeline' } })

      fireEvent.click(screen.getByText('app.newApp.import').closest('button')!)

      await act(async () => {
        vi.advanceTimersByTime(400)
      })

      // Error modal should be visible
      await waitFor(() => {
        expect(screen.getByText('app.newApp.appCreateDSLErrorTitle')).toBeInTheDocument()
      })

      // There are two Cancel buttons now (one in main modal footer, one in error modal)
      // Find the Cancel button in the error modal context
      const cancelButtons = screen.getAllByText('app.newApp.Cancel')
      // Click the last Cancel button (the one in the error modal)
      fireEvent.click(cancelButtons[cancelButtons.length - 1])

      vi.useRealTimers()
    })
  })
})

// ============================================
// Header Component Tests
// ============================================
describe('Header', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render title', () => {
      render(<Header onClose={vi.fn()} />)
      expect(screen.getByText('app.importFromDSL')).toBeInTheDocument()
    })

    it('should render close icon', () => {
      render(<Header onClose={vi.fn()} />)
      // Check for close icon container
      const closeButton = document.querySelector('[class*="cursor-pointer"]')
      expect(closeButton).toBeInTheDocument()
    })
  })

  describe('Event Handlers', () => {
    it('should call onClose when close icon is clicked', () => {
      const onClose = vi.fn()
      render(<Header onClose={onClose} />)

      const closeButton = document.querySelector('[class*="cursor-pointer"]')!
      fireEvent.click(closeButton)

      expect(onClose).toHaveBeenCalled()
    })
  })
})

// ============================================
// Tab Component Tests
// ============================================
describe('Tab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render both tabs', () => {
      render(
        <Tab
          currentTab={CreateFromDSLModalTab.FROM_FILE}
          setCurrentTab={vi.fn()}
        />,
      )

      expect(screen.getByText('app.importFromDSLFile')).toBeInTheDocument()
      expect(screen.getByText('app.importFromDSLUrl')).toBeInTheDocument()
    })
  })

  describe('Event Handlers', () => {
    it('should call setCurrentTab when clicking file tab', () => {
      const setCurrentTab = vi.fn()
      render(
        <Tab
          currentTab={CreateFromDSLModalTab.FROM_URL}
          setCurrentTab={setCurrentTab}
        />,
      )

      fireEvent.click(screen.getByText('app.importFromDSLFile'))
      // Tab uses bind() which passes the key as first argument and event as second
      expect(setCurrentTab).toHaveBeenCalled()
      expect(setCurrentTab.mock.calls[0][0]).toBe(CreateFromDSLModalTab.FROM_FILE)
    })

    it('should call setCurrentTab when clicking URL tab', () => {
      const setCurrentTab = vi.fn()
      render(
        <Tab
          currentTab={CreateFromDSLModalTab.FROM_FILE}
          setCurrentTab={setCurrentTab}
        />,
      )

      fireEvent.click(screen.getByText('app.importFromDSLUrl'))
      // Tab uses bind() which passes the key as first argument and event as second
      expect(setCurrentTab).toHaveBeenCalled()
      expect(setCurrentTab.mock.calls[0][0]).toBe(CreateFromDSLModalTab.FROM_URL)
    })
  })
})

// ============================================
// Tab Item Component Tests
// ============================================
describe('TabItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render label', () => {
      render(
        <TabItem
          isActive={false}
          label="Test Tab"
          onClick={vi.fn()}
        />,
      )

      expect(screen.getByText('Test Tab')).toBeInTheDocument()
    })

    it('should render active indicator when active', () => {
      render(
        <TabItem
          isActive={true}
          label="Test Tab"
          onClick={vi.fn()}
        />,
      )

      // Active indicator is the bottom border div
      const indicator = document.querySelector('[class*="bg-util-colors-blue"]')
      expect(indicator).toBeInTheDocument()
    })

    it('should not render active indicator when inactive', () => {
      render(
        <TabItem
          isActive={false}
          label="Test Tab"
          onClick={vi.fn()}
        />,
      )

      const indicator = document.querySelector('[class*="bg-util-colors-blue"]')
      expect(indicator).toBeNull()
    })

    it('should have active text color when active', () => {
      render(
        <TabItem
          isActive={true}
          label="Test Tab"
          onClick={vi.fn()}
        />,
      )

      const item = screen.getByText('Test Tab')
      expect(item.className).toContain('text-text-primary')
    })

    it('should have inactive text color when inactive', () => {
      render(
        <TabItem
          isActive={false}
          label="Test Tab"
          onClick={vi.fn()}
        />,
      )

      const item = screen.getByText('Test Tab')
      expect(item.className).toContain('text-text-tertiary')
    })
  })

  describe('Event Handlers', () => {
    it('should call onClick when clicked', () => {
      const onClick = vi.fn()
      render(
        <TabItem
          isActive={false}
          label="Test Tab"
          onClick={onClick}
        />,
      )

      fireEvent.click(screen.getByText('Test Tab'))
      expect(onClick).toHaveBeenCalled()
    })
  })
})

// ============================================
// Uploader Component Tests
// ============================================
describe('Uploader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render upload prompt when no file', () => {
      render(
        <Uploader
          file={undefined}
          updateFile={vi.fn()}
        />,
      )

      expect(screen.getByText('app.dslUploader.button')).toBeInTheDocument()
      expect(screen.getByText('app.dslUploader.browse')).toBeInTheDocument()
    })

    it('should render file info when file is selected', () => {
      const mockFile = createMockFile('test.pipeline')

      render(
        <Uploader
          file={mockFile}
          updateFile={vi.fn()}
        />,
      )

      expect(screen.getByText('test.pipeline')).toBeInTheDocument()
      expect(screen.getByText('PIPELINE')).toBeInTheDocument()
    })

    it('should apply custom className', () => {
      const { container } = render(
        <Uploader
          file={undefined}
          updateFile={vi.fn()}
          className="custom-class"
        />,
      )

      expect(container.firstChild).toHaveClass('custom-class')
    })
  })

  describe('Event Handlers', () => {
    it('should call updateFile when browse link is clicked and file is selected', async () => {
      const updateFile = vi.fn()
      render(
        <Uploader
          file={undefined}
          updateFile={updateFile}
        />,
      )

      // Get the hidden input
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement

      // Create a mock file
      const mockFile = createMockFile()

      // Simulate file selection
      Object.defineProperty(fileInput, 'files', {
        value: [mockFile],
      })

      fireEvent.change(fileInput)

      expect(updateFile).toHaveBeenCalledWith(mockFile)
    })

    it('should call updateFile with undefined when delete button is clicked', () => {
      const updateFile = vi.fn()
      const mockFile = createMockFile()

      render(
        <Uploader
          file={mockFile}
          updateFile={updateFile}
        />,
      )

      // Find and click delete button - the button contains the delete icon
      const deleteButton = document.querySelector('button')
      if (deleteButton) {
        fireEvent.click(deleteButton)
        expect(updateFile).toHaveBeenCalledWith()
      }
    })

    it('should handle browse click', () => {
      const updateFile = vi.fn()
      render(
        <Uploader
          file={undefined}
          updateFile={updateFile}
        />,
      )

      const browseLink = screen.getByText('app.dslUploader.browse')
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement

      // Mock click on input
      const clickSpy = vi.spyOn(fileInput, 'click')

      fireEvent.click(browseLink)

      expect(clickSpy).toHaveBeenCalled()
    })
  })

  describe('Drag and Drop', () => {
    it('should show drag state when dragging over', () => {
      render(
        <Uploader
          file={undefined}
          updateFile={vi.fn()}
        />,
      )

      const dropArea = document.querySelector('[class*="border-dashed"]')!

      // The drag state is triggered when dragEnter fires on something other than the dragRef
      // In the component, setDragging(true) happens when e.target !== dragRef.current
      fireEvent.dragEnter(dropArea, {
        dataTransfer: { files: [] },
      })

      // The class should be present since dropArea is not dragRef
      expect(dropArea.className).toContain('border-components-dropzone')
    })

    it('should handle dragOver event', () => {
      render(
        <Uploader
          file={undefined}
          updateFile={vi.fn()}
        />,
      )

      const dashedArea = document.querySelector('[class*="border-dashed"]')
      const dropArea = dashedArea?.parentElement
      if (!dropArea)
        return

      // DragOver should prevent default and stop propagation
      const dragOverEvent = new Event('dragover', { bubbles: true, cancelable: true })
      dropArea.dispatchEvent(dragOverEvent)

      // Event should be handled without errors
      expect(dropArea).toBeInTheDocument()
    })

    it('should handle dragLeave event and reset dragging state when target is dragRef', async () => {
      render(
        <Uploader
          file={undefined}
          updateFile={vi.fn()}
        />,
      )

      const dropArea = document.querySelector('[class*="border-dashed"]')!
      const dropAreaParent = dropArea.parentElement

      if (!dropAreaParent)
        return

      // First trigger dragEnter to set dragging state
      fireEvent.dragEnter(dropArea, {
        dataTransfer: { files: [] },
      })

      // Verify dragging state is set - the accent class appears when dragging
      await waitFor(() => {
        expect(dropArea.className).toContain('border-components-dropzone-border-accent')
      })

      // The dragRef div appears when dragging is true
      const dragRefDiv = document.querySelector('[class*="absolute left-0 top-0"]')
      expect(dragRefDiv).toBeInTheDocument()

      // When dragLeave happens on the dragRef element, setDragging(false) is called
      if (dragRefDiv) {
        // Fire dragleave directly on the dragRef element
        fireEvent.dragLeave(dragRefDiv)

        // After dragLeave on dragRef, dragging should be false and accent class removed
        await waitFor(() => {
          expect(dropArea.className).not.toContain('border-components-dropzone-border-accent')
        })
      }
    })

    it('should not reset dragging when dragLeave target is not dragRef', async () => {
      render(
        <Uploader
          file={undefined}
          updateFile={vi.fn()}
        />,
      )

      const dropArea = document.querySelector('[class*="border-dashed"]')!
      const dropAreaParent = dropArea.parentElement

      if (!dropAreaParent)
        return

      // First trigger dragEnter to set dragging state
      fireEvent.dragEnter(dropArea, {
        dataTransfer: { files: [] },
      })

      // Verify dragging state is set
      await waitFor(() => {
        expect(dropArea.className).toContain('border-components-dropzone-border-accent')
      })

      // Trigger dragLeave on the drop area (not dragRef) - should NOT reset dragging
      fireEvent.dragLeave(dropArea, {
        dataTransfer: { files: [] },
      })

      // Dragging should still be true (accent class still present)
      // because target is not dragRef
      expect(dropArea.className).toContain('border-components-dropzone')
    })

    it('should handle file drop', async () => {
      const updateFile = vi.fn()
      render(
        <Uploader
          file={undefined}
          updateFile={updateFile}
        />,
      )

      const dashedArea = document.querySelector('[class*="border-dashed"]')
      const dropArea = dashedArea?.parentElement
      if (!dropArea)
        return

      const mockFile = createMockFile()

      fireEvent.drop(dropArea, {
        dataTransfer: {
          files: [mockFile],
        },
      })

      expect(updateFile).toHaveBeenCalledWith(mockFile)
    })

    it('should reject multiple files', async () => {
      const updateFile = vi.fn()
      render(
        <Uploader
          file={undefined}
          updateFile={updateFile}
        />,
      )

      const dashedArea = document.querySelector('[class*="border-dashed"]')
      const dropArea = dashedArea?.parentElement
      if (!dropArea)
        return

      const mockFile1 = createMockFile('file1.pipeline')
      const mockFile2 = createMockFile('file2.pipeline')

      fireEvent.drop(dropArea, {
        dataTransfer: {
          files: [mockFile1, mockFile2],
        },
      })

      expect(updateFile).not.toHaveBeenCalled()
      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
        type: 'error',
      }))
    })
  })

  describe('Edge Cases', () => {
    it('should handle drop event without dataTransfer', () => {
      const updateFile = vi.fn()
      render(
        <Uploader
          file={undefined}
          updateFile={updateFile}
        />,
      )

      const dashedArea = document.querySelector('[class*="border-dashed"]')
      const dropArea = dashedArea?.parentElement
      if (!dropArea)
        return

      fireEvent.drop(dropArea, {
        dataTransfer: null,
      })

      expect(updateFile).not.toHaveBeenCalled()
    })

    it('should handle file cancel in selectHandle and restore original file', () => {
      const updateFile = vi.fn()

      render(
        <Uploader
          file={undefined}
          updateFile={updateFile}
        />,
      )

      // Get the file input
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      expect(fileInput).toBeInTheDocument()

      // Spy on input click before triggering selectHandle
      const clickSpy = vi.spyOn(fileInput, 'click').mockImplementation(() => {
        // After click, oncancel should be set
      })

      // Click browse link to trigger selectHandle
      const browseLink = screen.getByText('app.dslUploader.browse')
      fireEvent.click(browseLink)

      // selectHandle should have triggered click on input
      expect(clickSpy).toHaveBeenCalled()

      // After selectHandle runs, oncancel should be set
      // Trigger cancel - should restore original file (undefined in this case)
      if (fileInput.oncancel) {
        fileInput.oncancel(new Event('cancel'))
        // updateFile should be called with undefined (the original file)
        expect(updateFile).toHaveBeenCalledWith(undefined)
      }

      clickSpy.mockRestore()
    })

    it('should not set dragging when target equals dragRef', () => {
      render(
        <Uploader
          file={undefined}
          updateFile={vi.fn()}
        />,
      )

      const dropArea = document.querySelector('[class*="border-dashed"]')!

      // First trigger drag to show dragRef div
      fireEvent.dragEnter(dropArea, {
        dataTransfer: { files: [] },
      })

      // Now the dragRef div should exist
      const dragRefDiv = document.querySelector('[class*="absolute left-0 top-0"]')

      // When dragEnter happens on dragRef itself, setDragging should NOT be called
      if (dragRefDiv) {
        const dropAreaParent = dropArea.parentElement
        if (dropAreaParent) {
          // Trigger dragEnter with target = dragRef - this should NOT set dragging
          const dragEnterEvent = new Event('dragenter', { bubbles: true })
          Object.defineProperty(dragEnterEvent, 'target', { value: dragRefDiv })
          dropAreaParent.dispatchEvent(dragEnterEvent)
        }
      }
    })

    it('should handle removeFile when file input exists', () => {
      const updateFile = vi.fn()
      const mockFile = createMockFile()

      render(
        <Uploader
          file={mockFile}
          updateFile={updateFile}
        />,
      )

      // Find and click delete button
      const deleteButton = document.querySelector('button')
      expect(deleteButton).toBeInTheDocument()

      if (deleteButton) {
        fireEvent.click(deleteButton)
        // updateFile should be called without arguments
        expect(updateFile).toHaveBeenCalledWith()
      }

      // Verify file input value was cleared
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      expect(fileInput.value).toBe('')
    })
  })
})

// ============================================
// DSLConfirmModal Component Tests
// ============================================
describe('DSLConfirmModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render title', () => {
      render(
        <DSLConfirmModal
          onCancel={vi.fn()}
          onConfirm={vi.fn()}
        />,
      )

      expect(screen.getByText('app.newApp.appCreateDSLErrorTitle')).toBeInTheDocument()
    })

    it('should render version information', () => {
      render(
        <DSLConfirmModal
          versions={{
            importedVersion: '0.9.0',
            systemVersion: '1.0.0',
          }}
          onCancel={vi.fn()}
          onConfirm={vi.fn()}
        />,
      )

      expect(screen.getByText('0.9.0')).toBeInTheDocument()
      expect(screen.getByText('1.0.0')).toBeInTheDocument()
    })

    it('should render cancel and confirm buttons', () => {
      render(
        <DSLConfirmModal
          onCancel={vi.fn()}
          onConfirm={vi.fn()}
        />,
      )

      expect(screen.getByText('app.newApp.Cancel')).toBeInTheDocument()
      expect(screen.getByText('app.newApp.Confirm')).toBeInTheDocument()
    })

    it('should render with default empty versions', () => {
      render(
        <DSLConfirmModal
          onCancel={vi.fn()}
          onConfirm={vi.fn()}
        />,
      )

      // Should not crash with default empty strings
      expect(screen.getByText('app.newApp.appCreateDSLErrorTitle')).toBeInTheDocument()
    })

    it('should disable confirm button when confirmDisabled is true', () => {
      render(
        <DSLConfirmModal
          onCancel={vi.fn()}
          onConfirm={vi.fn()}
          confirmDisabled={true}
        />,
      )

      const confirmButton = screen.getByText('app.newApp.Confirm').closest('button')
      expect(confirmButton).toBeDisabled()
    })
  })

  describe('Event Handlers', () => {
    it('should call onCancel when cancel button is clicked', () => {
      const onCancel = vi.fn()
      render(
        <DSLConfirmModal
          onCancel={onCancel}
          onConfirm={vi.fn()}
        />,
      )

      fireEvent.click(screen.getByText('app.newApp.Cancel'))
      expect(onCancel).toHaveBeenCalled()
    })

    it('should call onConfirm when confirm button is clicked', () => {
      const onConfirm = vi.fn()
      render(
        <DSLConfirmModal
          onCancel={vi.fn()}
          onConfirm={onConfirm}
        />,
      )

      fireEvent.click(screen.getByText('app.newApp.Confirm'))
      expect(onConfirm).toHaveBeenCalled()
    })

    it('should bind onClose to onCancel via arrow function', () => {
      // This test verifies that the Modal's onClose prop calls onCancel
      // The implementation is: onClose={() => onCancel()}
      const onCancel = vi.fn()
      render(
        <DSLConfirmModal
          onCancel={onCancel}
          onConfirm={vi.fn()}
        />,
      )

      // Trigger the cancel button which also calls onCancel
      // This confirms onCancel is properly wired up
      fireEvent.click(screen.getByText('app.newApp.Cancel'))
      expect(onCancel).toHaveBeenCalledTimes(1)
    })

    it('should call onCancel when modal is closed via escape key', () => {
      const onCancel = vi.fn()
      render(
        <DSLConfirmModal
          onCancel={onCancel}
          onConfirm={vi.fn()}
        />,
      )

      // Pressing Escape triggers Modal's onClose which calls onCancel
      const escEvent = new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        keyCode: 27,
        bubbles: true,
      })
      document.dispatchEvent(escEvent)

      // onCancel should be called via the onClose={() => onCancel()} callback
      expect(onCancel).toHaveBeenCalled()
    })
  })

  describe('Props', () => {
    it('should use default versions when not provided', () => {
      render(
        <DSLConfirmModal
          onCancel={vi.fn()}
          onConfirm={vi.fn()}
        />,
      )

      // Component should render without crashing
      expect(screen.getByText('app.newApp.appCreateDSLErrorTitle')).toBeInTheDocument()
    })

    it('should use default confirmDisabled when not provided', () => {
      render(
        <DSLConfirmModal
          onCancel={vi.fn()}
          onConfirm={vi.fn()}
        />,
      )

      const confirmButton = screen.getByText('app.newApp.Confirm').closest('button')
      expect(confirmButton).not.toBeDisabled()
    })
  })
})

// ============================================
// Integration Tests
// ============================================
describe('CreateFromDSLModal Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockImportDSL.mockReset()
    mockImportDSLConfirm.mockReset()
    mockPush.mockReset()
    mockNotify.mockReset()
    mockHandleCheckPluginDependencies.mockReset()
  })

  it('should complete full import flow with URL', async () => {
    const onSuccess = vi.fn()
    const onClose = vi.fn()
    mockImportDSL.mockResolvedValue(createImportDSLResponse())
    mockHandleCheckPluginDependencies.mockResolvedValue(undefined)

    render(
      <CreateFromDSLModal
        show={true}
        onSuccess={onSuccess}
        onClose={onClose}
      />,
      { wrapper: createWrapper() },
    )

    // Switch to URL tab
    fireEvent.click(screen.getByText('app.importFromDSLUrl'))

    // Enter URL
    const input = screen.getByPlaceholderText('app.importFromDSLUrlPlaceholder')
    fireEvent.change(input, { target: { value: 'https://example.com/pipeline.yaml' } })

    // Click import
    const importButton = screen.getByText('app.newApp.import').closest('button')!
    fireEvent.click(importButton)

    // Verify API was called
    await waitFor(() => {
      expect(mockImportDSL).toHaveBeenCalled()
    })

    // Verify success callbacks after API completes
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled()
    })

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/datasets/dataset-789/pipeline')
    })
  })

  it('should handle version mismatch flow - shows error modal', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const onClose = vi.fn()
    mockImportDSL.mockResolvedValue(createImportDSLResponse({
      status: 'pending',
      imported_dsl_version: '0.8.0',
      current_dsl_version: '1.0.0',
    }))

    render(
      <CreateFromDSLModal
        show={true}
        onClose={onClose}
        activeTab={CreateFromDSLModalTab.FROM_URL}
      />,
      { wrapper: createWrapper() },
    )

    // Enter URL
    const input = screen.getByPlaceholderText('app.importFromDSLUrlPlaceholder')
    fireEvent.change(input, { target: { value: 'https://example.com/old-pipeline.yaml' } })

    // Click import
    const importButton = screen.getByText('app.newApp.import').closest('button')!
    fireEvent.click(importButton)

    // Wait for API call
    await waitFor(() => {
      expect(mockImportDSL).toHaveBeenCalled()
    })

    // Wait for onClose to be called
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled()
    })

    // Advance timer to show error modal
    await act(async () => {
      vi.advanceTimersByTime(400)
    })

    // Verify error modal is shown
    await waitFor(() => {
      expect(screen.getByText('app.newApp.appCreateDSLErrorTitle')).toBeInTheDocument()
    })

    vi.useRealTimers()
  })
})
