import type { Mock } from 'vitest'
import type { ExternalAPIItem } from '@/models/datasets'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createExternalKnowledgeBase } from '@/service/datasets'
import ExternalKnowledgeBaseConnector from './index'

// Mock next/navigation
const mockRouterBack = vi.fn()
const mockReplace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    back: mockRouterBack,
    replace: mockReplace,
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}))

// Mock useDocLink hook
vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path?: string) => `https://docs.dify.ai/en${path || ''}`,
}))

// Mock toast context
const mockNotify = vi.fn()
vi.mock('@/app/components/base/toast', () => ({
  useToastContext: () => ({
    notify: mockNotify,
  }),
}))

// Mock modal context
vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({
    setShowExternalKnowledgeAPIModal: vi.fn(),
  }),
}))

// Mock API service
vi.mock('@/service/datasets', () => ({
  createExternalKnowledgeBase: vi.fn(),
}))

// Factory function to create mock ExternalAPIItem
const createMockExternalAPIItem = (overrides: Partial<ExternalAPIItem> = {}): ExternalAPIItem => ({
  id: 'api-default',
  tenant_id: 'tenant-1',
  name: 'Default API',
  description: 'Default API description',
  settings: {
    endpoint: 'https://api.example.com',
    api_key: 'test-api-key',
  },
  dataset_bindings: [],
  created_by: 'user-1',
  created_at: '2024-01-01T00:00:00Z',
  ...overrides,
})

// Default mock API list
const createDefaultMockApiList = (): ExternalAPIItem[] => [
  createMockExternalAPIItem({
    id: 'api-1',
    name: 'Test API 1',
    settings: { endpoint: 'https://api1.example.com', api_key: 'key-1' },
  }),
  createMockExternalAPIItem({
    id: 'api-2',
    name: 'Test API 2',
    settings: { endpoint: 'https://api2.example.com', api_key: 'key-2' },
  }),
]

let mockExternalKnowledgeApiList: ExternalAPIItem[] = createDefaultMockApiList()

vi.mock('@/context/external-knowledge-api-context', () => ({
  useExternalKnowledgeApi: () => ({
    externalKnowledgeApiList: mockExternalKnowledgeApiList,
    mutateExternalKnowledgeApis: vi.fn(),
    isLoading: false,
  }),
}))

// Suppress console.error helper
const suppressConsoleError = () => vi.spyOn(console, 'error').mockImplementation(vi.fn())

// Helper to create a pending promise with external resolver
function createPendingPromise<T>() {
  let resolve: (value: T) => void = vi.fn()
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

// Helper to fill required form fields and submit
async function fillFormAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  const nameInput = screen.getByPlaceholderText('dataset.externalKnowledgeNamePlaceholder')
  const knowledgeIdInput = screen.getByPlaceholderText('dataset.externalKnowledgeIdPlaceholder')

  fireEvent.change(nameInput, { target: { value: 'Test Knowledge Base' } })
  fireEvent.change(knowledgeIdInput, { target: { value: 'kb-123' } })

  // Wait for button to be enabled
  await waitFor(() => {
    const connectButton = screen.getByText('dataset.externalKnowledgeForm.connect').closest('button')
    expect(connectButton).not.toBeDisabled()
  })

  const connectButton = screen.getByText('dataset.externalKnowledgeForm.connect').closest('button')
  await user.click(connectButton!)
}

describe('ExternalKnowledgeBaseConnector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExternalKnowledgeApiList = createDefaultMockApiList()
    ;(createExternalKnowledgeBase as Mock).mockResolvedValue({ id: 'new-kb-id' })
  })

  // Tests for rendering with real ExternalKnowledgeBaseCreate component
  describe('Rendering', () => {
    it('should render the create form with all required elements', () => {
      render(<ExternalKnowledgeBaseConnector />)

      // Verify main title and form elements
      expect(screen.getByText('dataset.connectDataset')).toBeInTheDocument()
      expect(screen.getByText('dataset.externalKnowledgeName')).toBeInTheDocument()
      expect(screen.getByText('dataset.externalKnowledgeId')).toBeInTheDocument()
      expect(screen.getByText('dataset.retrievalSettings')).toBeInTheDocument()

      // Verify buttons
      expect(screen.getByText('dataset.externalKnowledgeForm.cancel')).toBeInTheDocument()
      expect(screen.getByText('dataset.externalKnowledgeForm.connect')).toBeInTheDocument()
    })

    it('should render connect button disabled initially', () => {
      render(<ExternalKnowledgeBaseConnector />)

      const connectButton = screen.getByText('dataset.externalKnowledgeForm.connect').closest('button')
      expect(connectButton).toBeDisabled()
    })
  })

  // Tests for API success flow
  describe('API Success Flow', () => {
    it('should call API and show success notification when form is submitted', async () => {
      const user = userEvent.setup()
      render(<ExternalKnowledgeBaseConnector />)

      await fillFormAndSubmit(user)

      // Verify API was called with form data
      await waitFor(() => {
        expect(createExternalKnowledgeBase).toHaveBeenCalledWith({
          body: expect.objectContaining({
            name: 'Test Knowledge Base',
            external_knowledge_id: 'kb-123',
            external_knowledge_api_id: 'api-1',
            provider: 'external',
          }),
        })
      })

      // Verify success notification
      expect(mockNotify).toHaveBeenCalledWith({
        type: 'success',
        message: 'External Knowledge Base Connected Successfully',
      })

      // Verify navigation back
      expect(mockRouterBack).toHaveBeenCalledTimes(1)
    })

    it('should include retrieval settings in API call', async () => {
      const user = userEvent.setup()
      render(<ExternalKnowledgeBaseConnector />)

      await fillFormAndSubmit(user)

      await waitFor(() => {
        expect(createExternalKnowledgeBase).toHaveBeenCalledWith({
          body: expect.objectContaining({
            external_retrieval_model: expect.objectContaining({
              top_k: 4,
              score_threshold: 0.5,
              score_threshold_enabled: false,
            }),
          }),
        })
      })
    })
  })

  // Tests for API error flow
  describe('API Error Flow', () => {
    it('should show error notification when API fails', async () => {
      const user = userEvent.setup()
      const consoleErrorSpy = suppressConsoleError()
      ;(createExternalKnowledgeBase as Mock).mockRejectedValue(new Error('Network Error'))

      render(<ExternalKnowledgeBaseConnector />)

      await fillFormAndSubmit(user)

      // Verify error notification
      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith({
          type: 'error',
          message: 'Failed to connect External Knowledge Base',
        })
      })

      // Verify no navigation
      expect(mockRouterBack).not.toHaveBeenCalled()

      consoleErrorSpy.mockRestore()
    })

    it('should show error notification when API returns invalid result', async () => {
      const user = userEvent.setup()
      const consoleErrorSpy = suppressConsoleError()
      ;(createExternalKnowledgeBase as Mock).mockResolvedValue({})

      render(<ExternalKnowledgeBaseConnector />)

      await fillFormAndSubmit(user)

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith({
          type: 'error',
          message: 'Failed to connect External Knowledge Base',
        })
      })

      expect(mockRouterBack).not.toHaveBeenCalled()

      consoleErrorSpy.mockRestore()
    })
  })

  // Tests for loading state
  describe('Loading State', () => {
    it('should show loading state during API call', async () => {
      const user = userEvent.setup()

      // Create a promise that won't resolve immediately
      const { promise, resolve: resolvePromise } = createPendingPromise<{ id: string }>()
      ;(createExternalKnowledgeBase as Mock).mockReturnValue(promise)

      render(<ExternalKnowledgeBaseConnector />)

      // Fill form
      const nameInput = screen.getByPlaceholderText('dataset.externalKnowledgeNamePlaceholder')
      const knowledgeIdInput = screen.getByPlaceholderText('dataset.externalKnowledgeIdPlaceholder')
      fireEvent.change(nameInput, { target: { value: 'Test' } })
      fireEvent.change(knowledgeIdInput, { target: { value: 'kb-1' } })

      await waitFor(() => {
        const connectButton = screen.getByText('dataset.externalKnowledgeForm.connect').closest('button')
        expect(connectButton).not.toBeDisabled()
      })

      // Click connect
      const connectButton = screen.getByText('dataset.externalKnowledgeForm.connect').closest('button')
      await user.click(connectButton!)

      // Button should show loading (the real Button component has loading prop)
      await waitFor(() => {
        expect(createExternalKnowledgeBase).toHaveBeenCalled()
      })

      // Resolve the promise
      resolvePromise({ id: 'new-id' })

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith({
          type: 'success',
          message: 'External Knowledge Base Connected Successfully',
        })
      })
    })
  })

  // Tests for form validation (integration with real create component)
  describe('Form Validation', () => {
    it('should keep button disabled when only name is filled', () => {
      render(<ExternalKnowledgeBaseConnector />)

      const nameInput = screen.getByPlaceholderText('dataset.externalKnowledgeNamePlaceholder')
      fireEvent.change(nameInput, { target: { value: 'Test' } })

      const connectButton = screen.getByText('dataset.externalKnowledgeForm.connect').closest('button')
      expect(connectButton).toBeDisabled()
    })

    it('should keep button disabled when only knowledge id is filled', () => {
      render(<ExternalKnowledgeBaseConnector />)

      const knowledgeIdInput = screen.getByPlaceholderText('dataset.externalKnowledgeIdPlaceholder')
      fireEvent.change(knowledgeIdInput, { target: { value: 'kb-1' } })

      const connectButton = screen.getByText('dataset.externalKnowledgeForm.connect').closest('button')
      expect(connectButton).toBeDisabled()
    })

    it('should enable button when all required fields are filled', async () => {
      render(<ExternalKnowledgeBaseConnector />)

      const nameInput = screen.getByPlaceholderText('dataset.externalKnowledgeNamePlaceholder')
      const knowledgeIdInput = screen.getByPlaceholderText('dataset.externalKnowledgeIdPlaceholder')

      fireEvent.change(nameInput, { target: { value: 'Test' } })
      fireEvent.change(knowledgeIdInput, { target: { value: 'kb-1' } })

      await waitFor(() => {
        const connectButton = screen.getByText('dataset.externalKnowledgeForm.connect').closest('button')
        expect(connectButton).not.toBeDisabled()
      })
    })
  })

  // Tests for user interactions
  describe('User Interactions', () => {
    it('should allow typing in form fields', async () => {
      const user = userEvent.setup()
      render(<ExternalKnowledgeBaseConnector />)

      const nameInput = screen.getByPlaceholderText('dataset.externalKnowledgeNamePlaceholder')
      const descriptionInput = screen.getByPlaceholderText('dataset.externalKnowledgeDescriptionPlaceholder')

      await user.type(nameInput, 'My Knowledge Base')
      await user.type(descriptionInput, 'My Description')

      expect((nameInput as HTMLInputElement).value).toBe('My Knowledge Base')
      expect((descriptionInput as HTMLTextAreaElement).value).toBe('My Description')
    })

    it('should handle cancel button click', async () => {
      const user = userEvent.setup()
      render(<ExternalKnowledgeBaseConnector />)

      const cancelButton = screen.getByText('dataset.externalKnowledgeForm.cancel').closest('button')
      await user.click(cancelButton!)

      expect(mockReplace).toHaveBeenCalledWith('/datasets')
    })

    it('should handle back button click', async () => {
      const user = userEvent.setup()
      render(<ExternalKnowledgeBaseConnector />)

      const buttons = screen.getAllByRole('button')
      const backButton = buttons.find(btn => btn.classList.contains('rounded-full'))
      await user.click(backButton!)

      expect(mockReplace).toHaveBeenCalledWith('/datasets')
    })
  })
})
