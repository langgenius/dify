import type { ExternalKnowledgeApiResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createExternalKnowledgeBase } from '@/service/datasets'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import ExternalKnowledgeBaseConnector from '../index'

const mockRouterBack = vi.fn()
const mockReplace = vi.fn()
vi.mock('@/next/navigation', () => ({
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

const mockToastSuccess = vi.hoisted(() => vi.fn())
const mockToastError = vi.hoisted(() => vi.fn())
vi.mock('@/app/notifications', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/notifications')>()
  return {
    ...actual,
    toast: {
      ...actual.toast,
      success: mockToastSuccess,
      error: mockToastError,
    },
  }
})

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
const createMockExternalAPIItem = (
  overrides: Partial<ExternalKnowledgeApiResponse> = {},
): ExternalKnowledgeApiResponse => ({
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
const createDefaultMockApiList = (): ExternalKnowledgeApiResponse[] => [
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

let mockExternalKnowledgeApiList: ExternalKnowledgeApiResponse[] = createDefaultMockApiList()

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.externalKnowledgeApi.get': () => ({ data: mockExternalKnowledgeApiList }),
    }),
  }
})

// Suppress console.error helper
const suppressConsoleError = () => vi.spyOn(console, 'error').mockImplementation(vi.fn())

// Helper to fill required form fields and submit
async function fillFormAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  const nameInput = screen.getByPlaceholderText('dataset.externalKnowledgeNamePlaceholder')
  const knowledgeIdInput = screen.getByPlaceholderText('dataset.externalKnowledgeIdPlaceholder')

  await user.type(nameInput, 'Test Knowledge Base')
  await user.type(knowledgeIdInput, 'kb-123')

  // Wait for button to be enabled
  await waitFor(() => {
    const connectButton = screen
      .getByText('dataset.externalKnowledgeForm.connect')
      .closest('button')
    expect(connectButton).not.toBeDisabled()
  })

  const connectButton = screen.getByText('dataset.externalKnowledgeForm.connect').closest('button')
  await user.click(connectButton!)
}

describe('ExternalKnowledgeBaseConnector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExternalKnowledgeApiList = createDefaultMockApiList()
    vi.mocked(createExternalKnowledgeBase).mockResolvedValue(
      createDatasetFixture({ id: 'new-kb-id' }),
    )
  })

  // Tests for rendering with real ExternalKnowledgeBaseCreate component

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
            external_retrieval_model: {
              top_k: 4,
              score_threshold: 0.5,
              score_threshold_enabled: false,
            },
          }),
        })
      })

      // Verify success notification
      expect(mockToastSuccess).toHaveBeenCalledWith(
        'dataset.externalKnowledgeForm.connectedSuccess',
      )

      // Verify navigation back
      expect(mockRouterBack).toHaveBeenCalledTimes(1)
    })
  })

  // Tests for API error flow
  describe('API Error Flow', () => {
    it('should show error notification when API fails', async () => {
      const user = userEvent.setup()
      const consoleErrorSpy = suppressConsoleError()
      vi.mocked(createExternalKnowledgeBase).mockRejectedValue(new Error('Network Error'))

      render(<ExternalKnowledgeBaseConnector />)

      await fillFormAndSubmit(user)

      // Verify error notification
      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith('dataset.externalKnowledgeForm.connectedFailed')
      })

      // Verify no navigation
      expect(mockRouterBack).not.toHaveBeenCalled()

      consoleErrorSpy.mockRestore()
    })
  })

  // Tests for loading state
  describe('Loading State', () => {
    it('should show loading state during API call', async () => {
      const user = userEvent.setup()

      // Create a promise that won't resolve immediately
      const { promise, resolve: resolvePromise } =
        createDeferred<Awaited<ReturnType<typeof createExternalKnowledgeBase>>>()
      vi.mocked(createExternalKnowledgeBase).mockReturnValue(promise)

      render(<ExternalKnowledgeBaseConnector />)

      // Fill form
      const nameInput = screen.getByPlaceholderText('dataset.externalKnowledgeNamePlaceholder')
      const knowledgeIdInput = screen.getByPlaceholderText('dataset.externalKnowledgeIdPlaceholder')
      await user.type(nameInput, 'Test')
      await user.type(knowledgeIdInput, 'kb-1')

      await waitFor(() => {
        const connectButton = screen
          .getByText('dataset.externalKnowledgeForm.connect')
          .closest('button')
        expect(connectButton).not.toBeDisabled()
      })

      const connectButton = screen
        .getByText('dataset.externalKnowledgeForm.connect')
        .closest('button')
      await user.click(connectButton!)

      // Button should show loading (the real Button component has loading prop)
      await waitFor(() => {
        expect(createExternalKnowledgeBase).toHaveBeenCalled()
      })

      expect(connectButton).toHaveAttribute('aria-disabled', 'true')
      await user.click(connectButton!)
      expect(createExternalKnowledgeBase).toHaveBeenCalledOnce()
      await act(async () => resolvePromise(createDatasetFixture({ id: 'new-id' })))

      await waitFor(() => {
        expect(mockToastSuccess).toHaveBeenCalledWith(
          'dataset.externalKnowledgeForm.connectedSuccess',
        )
      })
    })
  })

  // Tests for form validation (integration with real create component)

  // Tests for user interactions
  describe('User Interactions', () => {
    it('should link back to the dataset list from cancel', () => {
      render(<ExternalKnowledgeBaseConnector />)

      expect(
        screen.getByRole('link', { name: 'dataset.externalKnowledgeForm.cancel' }),
      ).toHaveAttribute('href', '/datasets')
    })

    it('should handle back button click', async () => {
      const user = userEvent.setup()
      render(<ExternalKnowledgeBaseConnector />)

      await user.click(screen.getByRole('button', { name: 'common.operation.back' }))

      expect(mockReplace).toHaveBeenCalledWith('/datasets')
    })
  })
})
