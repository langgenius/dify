import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DSLConfirmModal from '../dsl-confirm-modal'
import CreateFromDSLModal, { CreateFromDSLModalTab } from '../index'

const mockPush = vi.fn()
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}))

const mockImportDSL = vi.fn()
const mockImportDSLConfirm = vi.fn()

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'rag.pipelines.imports.post': (input) => mockImportDSL(input),
      'rag.pipelines.imports.byImportId.confirm.post': (input) => mockImportDSLConfirm(input),
    }),
  }
})

// Mock plugin dependencies hook
const mockHandleCheckPluginDependencies = vi.fn()

vi.mock('@/app/components/workflow/plugin-dependency/hooks', () => ({
  usePluginDependencies: () => ({
    handleCheckPluginDependencies: mockHandleCheckPluginDependencies,
  }),
}))

const toastMocks = vi.hoisted(() => {
  const record = vi.fn()
  const api = vi.fn((message: unknown, options?: Record<string, unknown>) =>
    record({ message, ...options }),
  )
  return {
    record,
    api: Object.assign(api, {
      success: vi.fn((message: unknown, options?: Record<string, unknown>) =>
        record({ type: 'success', message, ...options }),
      ),
      error: vi.fn((message: unknown, options?: Record<string, unknown>) =>
        record({ type: 'error', message, ...options }),
      ),
      warning: vi.fn((message: unknown, options?: Record<string, unknown>) =>
        record({ type: 'warning', message, ...options }),
      ),
      info: vi.fn((message: unknown, options?: Record<string, unknown>) =>
        record({ type: 'info', message, ...options }),
      ),
      dismiss: vi.fn(),
      update: vi.fn(),
      promise: vi.fn(),
    }),
  }
})

vi.mock('@/app/notifications', () => ({
  toast: toastMocks.api,
}))

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
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('CreateFromDSLModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockImportDSL.mockReset()
    mockImportDSLConfirm.mockReset()
    mockPush.mockReset()
    toastMocks.record.mockReset()
    mockHandleCheckPluginDependencies.mockReset()
  })

  describe('Rendering', () => {
    it('should not render modal content when show is false', () => {
      render(<CreateFromDSLModal show={false} onClose={vi.fn()} />, { wrapper: createWrapper() })

      // Modal with show=false should not display its content visibly
      const modal = screen.queryByText('app.importFromDSL')
      expect(modal).toBeNull()
    })
  })

  describe('Props', () => {
    it('should call onClose when cancel button is clicked', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()
      render(<CreateFromDSLModal show={true} onClose={onClose} />, { wrapper: createWrapper() })

      await user.click(screen.getByText('app.newApp.Cancel'))
      expect(onClose).toHaveBeenCalled()
    })
  })

  describe('State Management', () => {
    it('should move focus from the URL tab directly into its field', async () => {
      const user = userEvent.setup()
      render(<CreateFromDSLModal show={true} onClose={vi.fn()} />, { wrapper: createWrapper() })

      const urlTab = screen.getByRole('tab', { name: 'app.importFromDSLUrl' })
      await user.click(urlTab)

      const input = screen.getByRole('textbox', { name: 'DSL URL' })
      await user.tab()

      expect(input)!.toHaveFocus()
    })

    it.each([CreateFromDSLModalTab.FROM_FILE, CreateFromDSLModalTab.FROM_URL])(
      'prevents importing an empty %s input',
      (activeTab) => {
        render(<CreateFromDSLModal show onClose={vi.fn()} activeTab={activeTab} />, {
          wrapper: createWrapper(),
        })
        expect(screen.getByRole('button', { name: 'app.newApp.import' })).toBeDisabled()
      },
    )
  })

  // API Call Tests
  describe('API Calls', () => {
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

      const user = userEvent.setup()
      const input = screen.getByPlaceholderText('app.importFromDSLUrlPlaceholder')
      await user.type(input, 'https://example.com/test.pipeline')

      const importButton = screen.getByRole('button', { name: 'app.newApp.import' })
      await user.click(importButton)

      await waitFor(() => {
        expect(mockImportDSL).toHaveBeenCalledExactlyOnceWith({
          body: { mode: 'yaml-url', yaml_url: 'https://example.com/test.pipeline' },
        })
        expect(mockHandleCheckPluginDependencies).toHaveBeenCalledExactlyOnceWith(
          'pipeline-456',
          true,
        )
        expect(onSuccess).toHaveBeenCalledOnce()
        expect(onClose).toHaveBeenCalled()
        expect(toastMocks.record).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'success',
          }),
        )
        expect(mockPush).toHaveBeenCalledWith('/datasets/dataset-789/pipeline')
      })
    })

    it('should handle API error', async () => {
      const user = userEvent.setup()
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
      await user.type(input, 'https://example.com/test.pipeline')

      const importButton = screen.getByRole('button', { name: 'app.newApp.import' })
      await user.click(importButton)

      await waitFor(() => {
        expect(toastMocks.record).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'error',
          }),
        )
      })
    })

    it('should handle FAILED status', async () => {
      const user = userEvent.setup()
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
      await user.type(input, 'https://example.com/test.pipeline')

      const importButton = screen.getByRole('button', { name: 'app.newApp.import' })
      await user.click(importButton)

      await waitFor(() => {
        expect(toastMocks.record).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'error',
          }),
        )
      })
    })
  })

  // Event Handler Tests
  describe('Event Handlers', () => {
    it('should call onClose when header close button is clicked', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()
      render(<CreateFromDSLModal show={true} onClose={onClose} />, { wrapper: createWrapper() })

      await user.click(screen.getByRole('button', { name: 'common.operation.close' }))

      expect(onClose).toHaveBeenCalled()
    })

    it('should submit a URL import when Enter is pressed in the URL field', async () => {
      const user = userEvent.setup()
      mockImportDSL.mockResolvedValue(createImportDSLResponse())
      render(
        <CreateFromDSLModal
          show={true}
          onClose={vi.fn()}
          activeTab={CreateFromDSLModalTab.FROM_URL}
        />,
        { wrapper: createWrapper() },
      )

      const input = screen.getByRole('textbox', { name: 'DSL URL' })
      await user.type(input, 'https://example.com/test.pipeline{Enter}')

      await waitFor(() => {
        expect(mockImportDSL).toHaveBeenCalledWith({
          body: {
            mode: 'yaml-url',
            yaml_url: 'https://example.com/test.pipeline',
          },
        })
      })
    })

    it('should close modal on ESC key press', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()
      render(<CreateFromDSLModal show={true} onClose={onClose} />, { wrapper: createWrapper() })

      await user.keyboard('{Escape}')

      expect(onClose).toHaveBeenCalled()
    })

    it('should not close on ESC when error modal is shown', async () => {
      const user = userEvent.setup()
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
      await user.type(input, 'https://example.com/test.pipeline')

      const importButton = screen.getByRole('button', { name: 'app.newApp.import' })
      await user.click(importButton)

      await waitFor(() => {
        expect(onClose).toHaveBeenCalled()
      })

      // Clear previous calls
      onClose.mockClear()

      await screen.findByRole('alertdialog')

      // Now ESC should not close main modal because error modal is shown
      await user.keyboard('{Escape}')

      // onClose should not be called again when error modal is shown
      expect(onClose).not.toHaveBeenCalled()
    })

    it('should prevent duplicate submissions', async () => {
      const user = userEvent.setup()
      let resolve!: (value: ReturnType<typeof createImportDSLResponse>) => void
      mockImportDSL.mockImplementationOnce(
        () =>
          new Promise((res) => {
            resolve = res
          }),
      )

      render(
        <CreateFromDSLModal
          show={true}
          onClose={vi.fn()}
          activeTab={CreateFromDSLModalTab.FROM_URL}
        />,
        { wrapper: createWrapper() },
      )

      const input = screen.getByPlaceholderText('app.importFromDSLUrlPlaceholder')
      await user.type(input, 'https://example.com/test.pipeline')

      const importButton = screen.getByRole('button', { name: 'app.newApp.import' })

      await user.click(importButton)
      await user.click(importButton)
      await user.click(importButton)

      // Should only be called once due to isCreatingRef
      await waitFor(() => {
        expect(mockImportDSL).toHaveBeenCalledTimes(1)
      })
      await act(async () => resolve(createImportDSLResponse()))
    })
  })

  // File Import Tests (covers readFile, handleFile, file mode import)
  describe('File Import', () => {
    it('should read file content when file is selected', async () => {
      const user = userEvent.setup()
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
      const mockFile = new File([fileContent], 'test.pipeline', {
        type: 'application/octet-stream',
      })

      // Get the file input and simulate file selection
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      await user.upload(fileInput, mockFile)

      // Wait for FileReader to complete
      await waitFor(() => {
        const importButton = screen.getByRole('button', { name: 'app.newApp.import' })
        expect(importButton).not.toBeDisabled()
      })

      const importButton = screen.getByRole('button', { name: 'app.newApp.import' })
      await user.click(importButton)

      // Verify API was called with file content
      await waitFor(() => {
        expect(mockImportDSL).toHaveBeenCalledWith({
          body: {
            mode: 'yaml-content',
            yaml_content: fileContent,
          },
        })
      })
    })

    it('should clear file content when file is removed', async () => {
      const user = userEvent.setup()
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
      await user.upload(fileInput, mockFile)

      // Wait for file to be displayed
      await waitFor(() => {
        expect(screen.getByText('test.pipeline'))!.toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: 'common.operation.remove' }))
      expect(screen.queryByText('test.pipeline')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'app.newApp.import' })).toBeDisabled()
      expect(mockImportDSL).not.toHaveBeenCalled()
    })
  })

  // DSL Confirm Flow Tests (covers onDSLConfirm)
  describe('DSL Confirm Flow', () => {
    it('should handle DSL confirm success', async () => {
      const user = userEvent.setup()
      const onSuccess = vi.fn()
      const onClose = vi.fn()

      mockImportDSL.mockResolvedValue(
        createImportDSLResponse({
          id: 'import-123',
          status: 'pending',
          imported_dsl_version: '0.9.0',
          current_dsl_version: '1.0.0',
        }),
      )

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
      await user.type(input, 'https://example.com/test.pipeline')

      const importButton = screen.getByRole('button', { name: 'app.newApp.import' })
      await user.click(importButton)

      // Wait for pending status handling
      await waitFor(() => {
        expect(onClose).toHaveBeenCalled()
      })

      // Advance timer to show error modal

      await waitFor(() => {
        expect(screen.getByText('app.newApp.Confirm'))!.toBeInTheDocument()
      })

      expect(screen.getByText('0.9.0')).toBeInTheDocument()
      expect(screen.getByText('1.0.0')).toBeInTheDocument()
      await user.click(screen.getByText('app.newApp.Confirm'))

      // Verify confirm was called
      await waitFor(() => {
        expect(mockImportDSLConfirm).toHaveBeenCalledWith({ params: { import_id: 'import-123' } })
      })

      await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/datasets/dataset-789/pipeline'))
      expect(screen.queryByText('app.newApp.Confirm')).not.toBeInTheDocument()
      expect(mockHandleCheckPluginDependencies).toHaveBeenCalledWith('pipeline-456', true)

      expect(onSuccess).toHaveBeenCalledOnce()
      expect(mockPush).toHaveBeenCalledWith('/datasets/dataset-789/pipeline')
    })

    it('should handle DSL confirm with FAILED status', async () => {
      const user = userEvent.setup()

      mockImportDSL.mockResolvedValue(
        createImportDSLResponse({
          id: 'import-123',
          status: 'pending',
        }),
      )

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
      await user.type(input, 'https://example.com/test.pipeline')

      await user.click(screen.getByRole('button', { name: 'app.newApp.import' }))

      await waitFor(() => {
        expect(screen.getByText('app.newApp.Confirm'))!.toBeInTheDocument()
      })

      await user.click(screen.getByText('app.newApp.Confirm'))

      await waitFor(() => {
        expect(toastMocks.record).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'error',
          }),
        )
      })
    })

    it('should close error modal when cancel is clicked', async () => {
      const user = userEvent.setup()

      mockImportDSL.mockResolvedValue(
        createImportDSLResponse({
          status: 'pending',
        }),
      )

      render(
        <CreateFromDSLModal
          show={true}
          onClose={vi.fn()}
          activeTab={CreateFromDSLModalTab.FROM_URL}
        />,
        { wrapper: createWrapper() },
      )

      const input = screen.getByPlaceholderText('app.importFromDSLUrlPlaceholder')
      await user.type(input, 'https://example.com/test.pipeline')

      await user.click(screen.getByRole('button', { name: 'app.newApp.import' }))

      // Error modal should be visible
      await waitFor(() => {
        expect(screen.getByText('app.newApp.appCreateDSLErrorTitle'))!.toBeInTheDocument()
      })

      // There are two Cancel buttons now (one in main modal footer, one in error modal)
      // Find the Cancel button in the error modal context
      const cancelButtons = screen.getAllByText('app.newApp.Cancel')
      await user.click(cancelButtons[cancelButtons.length - 1]!)

      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
      expect(mockImportDSLConfirm).not.toHaveBeenCalled()
      expect(mockPush).not.toHaveBeenCalled()
    })
  })
})

describe('DSLConfirmModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should disable confirm button when confirmDisabled is true', () => {
      render(<DSLConfirmModal onCancel={vi.fn()} onConfirm={vi.fn()} confirmDisabled={true} />)

      const confirmButton = screen.getByRole('button', { name: 'app.newApp.Confirm' })
      expect(confirmButton)!.toBeDisabled()
    })
  })
})
