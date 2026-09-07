import type { ExternalKnowledgeApiResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import ExternalAPIPanel from '../index'

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.example.com${path}`,
}))

const mockSetShowExternalKnowledgeAPIModal = vi.fn()
const mockInvalidateQueries = vi.fn()
const externalKnowledgeApiQueryKey = ['console', 'datasets', 'externalKnowledgeApi', 'get']
let mockIsLoading = false
let mockExternalKnowledgeApiList: ExternalKnowledgeApiResponse[] = []

vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({
    setShowExternalKnowledgeAPIModal: mockSetShowExternalKnowledgeAPIModal,
  }),
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...original,
    useQuery: () => ({
      data: { data: mockExternalKnowledgeApiList },
      isLoading: mockIsLoading,
    }),
    useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
  }
})

vi.mock('@/service/client', () => ({
  consoleQuery: {
    datasets: {
      externalKnowledgeApi: {
        get: {
          queryOptions: () => ({
            queryKey: ['console', 'datasets', 'externalKnowledgeApi', 'get'],
          }),
        },
      },
    },
  },
}))

// Mock the ExternalKnowledgeAPICard to avoid mocking its internal dependencies
vi.mock('../../external-knowledge-api-card', () => ({
  default: ({
    api,
    canManageExternalKnowledgeApi,
  }: {
    api: ExternalKnowledgeApiResponse
    canManageExternalKnowledgeApi: boolean
  }) => (
    <div
      data-testid={`api-card-${api.id}`}
      data-can-manage-external-knowledge-api={canManageExternalKnowledgeApi}
    >
      {api.name}
    </div>
  ),
}))

// i18n mock returns 'namespace.key' format

describe('ExternalAPIPanel', () => {
  const defaultProps = {
    canManageExternalKnowledgeApi: true,
    onClose: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockIsLoading = false
    mockExternalKnowledgeApiList = []
  })

  describe('Rendering', () => {
    it('should render panel title and description', () => {
      render(<ExternalAPIPanel {...defaultProps} />)
      expect(screen.getByText('dataset.externalAPIPanelTitle'))!.toBeInTheDocument()
      expect(screen.getByText('dataset.externalAPIPanelDescription'))!.toBeInTheDocument()
    })

    it('should render documentation link', () => {
      render(<ExternalAPIPanel {...defaultProps} />)
      const docLink = screen.getByText('dataset.externalAPIPanelDocumentation')
      expect(docLink)!.toBeInTheDocument()
      expect(docLink.closest('a'))!.toHaveAttribute(
        'href',
        'https://docs.example.com/use-dify/knowledge/external-knowledge-api',
      )
    })

    it('should render create button', () => {
      render(<ExternalAPIPanel {...defaultProps} />)
      expect(screen.getByText('dataset.createExternalAPI'))!.toBeInTheDocument()
    })

    it('should hide create button when external knowledge API management is unavailable', () => {
      render(<ExternalAPIPanel {...defaultProps} canManageExternalKnowledgeApi={false} />)
      expect(screen.queryByText('dataset.createExternalAPI')).not.toBeInTheDocument()
    })

    it('should render close button', () => {
      render(<ExternalAPIPanel {...defaultProps} />)
      expect(screen.getByRole('button', { name: 'common.operation.close' })).toBeInTheDocument()
    })
  })

  describe('Loading State', () => {
    it('should render loading indicator when isLoading is true', () => {
      mockIsLoading = true
      const { container } = render(<ExternalAPIPanel {...defaultProps} />)
      // Loading component should be rendered
      const loadingElement =
        container.querySelector('[class*="loading"]') ||
        container.querySelector('.animate-spin') ||
        screen.queryByRole('status')
      expect(loadingElement || container.textContent).toBeTruthy()
    })
  })

  describe('API List Rendering', () => {
    it('should render empty list when no APIs exist', () => {
      mockExternalKnowledgeApiList = []
      render(<ExternalAPIPanel {...defaultProps} />)
      expect(screen.queryByTestId(/api-card-/)).not.toBeInTheDocument()
    })

    it('should render API cards when APIs exist', () => {
      mockExternalKnowledgeApiList = [
        {
          id: 'api-1',
          tenant_id: 'tenant-1',
          name: 'Test API 1',
          description: '',
          settings: { endpoint: 'https://api1.example.com', api_key: 'key1' },
          dataset_bindings: [],
          created_by: 'user-1',
          created_at: '2021-01-01T00:00:00Z',
        },
        {
          id: 'api-2',
          tenant_id: 'tenant-1',
          name: 'Test API 2',
          description: '',
          settings: { endpoint: 'https://api2.example.com', api_key: 'key2' },
          dataset_bindings: [],
          created_by: 'user-1',
          created_at: '2021-01-01T00:00:00Z',
        },
      ]
      render(<ExternalAPIPanel {...defaultProps} />)
      expect(screen.getByTestId('api-card-api-1'))!.toBeInTheDocument()
      expect(screen.getByTestId('api-card-api-2'))!.toBeInTheDocument()
      expect(screen.getByTestId('api-card-api-1')).toHaveAttribute(
        'data-can-manage-external-knowledge-api',
        'true',
      )
      expect(screen.getByText('Test API 1'))!.toBeInTheDocument()
      expect(screen.getByText('Test API 2'))!.toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onClose when close button is clicked', () => {
      const onClose = vi.fn()
      render(<ExternalAPIPanel canManageExternalKnowledgeApi={true} onClose={onClose} />)
      fireEvent.click(screen.getByRole('button', { name: 'common.operation.close' }))
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('should open external API modal when create button is clicked', async () => {
      render(<ExternalAPIPanel {...defaultProps} />)
      const createButton = screen.getByText('dataset.createExternalAPI').closest('button')!
      fireEvent.click(createButton)

      await waitFor(() => {
        expect(mockSetShowExternalKnowledgeAPIModal).toHaveBeenCalledTimes(1)
        expect(mockSetShowExternalKnowledgeAPIModal).toHaveBeenCalledWith(
          expect.objectContaining({
            payload: { name: '', settings: { endpoint: '', api_key: '' } },
            datasetBindings: [],
            isEditMode: false,
          }),
        )
      })
    })

    it('should invalidate the generated external API query after creation', async () => {
      render(<ExternalAPIPanel {...defaultProps} />)
      const createButton = screen.getByText('dataset.createExternalAPI').closest('button')!
      fireEvent.click(createButton)

      const callArgs = mockSetShowExternalKnowledgeAPIModal.mock.calls[0]![0]
      await callArgs.onSaveCallback()

      expect(mockInvalidateQueries).toHaveBeenCalledWith({
        queryKey: externalKnowledgeApiQueryKey,
      })
    })

    it('should not refresh the query when creation is canceled', async () => {
      render(<ExternalAPIPanel {...defaultProps} />)
      const createButton = screen.getByText('dataset.createExternalAPI').closest('button')!
      fireEvent.click(createButton)

      const callArgs = mockSetShowExternalKnowledgeAPIModal.mock.calls[0]![0]

      expect(callArgs.onCancelCallback).toBeUndefined()
      expect(mockInvalidateQueries).not.toHaveBeenCalled()
    })
  })

  describe('Edge Cases', () => {
    it('should handle single API in list', () => {
      mockExternalKnowledgeApiList = [
        {
          id: 'single-api',
          tenant_id: 'tenant-1',
          name: 'Single API',
          description: '',
          settings: { endpoint: 'https://single.example.com', api_key: 'key' },
          dataset_bindings: [],
          created_by: 'user-1',
          created_at: '2021-01-01T00:00:00Z',
        },
      ]
      render(<ExternalAPIPanel {...defaultProps} />)
      expect(screen.getByTestId('api-card-single-api'))!.toBeInTheDocument()
    })

    it('should render documentation link with correct target', () => {
      render(<ExternalAPIPanel {...defaultProps} />)
      const docLink = screen.getByText('dataset.externalAPIPanelDocumentation').closest('a')
      expect(docLink)!.toHaveAttribute('target', '_blank')
    })
  })
})
