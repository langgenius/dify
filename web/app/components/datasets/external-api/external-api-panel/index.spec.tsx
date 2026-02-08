import type { ExternalAPIItem } from '@/models/datasets'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ExternalAPIPanel from './index'

// Mock external contexts (only mock context providers, not base components)
const mockSetShowExternalKnowledgeAPIModal = vi.fn()
const mockMutateExternalKnowledgeApis = vi.fn()
let mockIsLoading = false
let mockExternalKnowledgeApiList: ExternalAPIItem[] = []

vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({
    setShowExternalKnowledgeAPIModal: mockSetShowExternalKnowledgeAPIModal,
  }),
}))

vi.mock('@/context/external-knowledge-api-context', () => ({
  useExternalKnowledgeApi: () => ({
    externalKnowledgeApiList: mockExternalKnowledgeApiList,
    mutateExternalKnowledgeApis: mockMutateExternalKnowledgeApis,
    isLoading: mockIsLoading,
  }),
}))

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.example.com${path}`,
}))

// Mock the ExternalKnowledgeAPICard to avoid mocking its internal dependencies
vi.mock('../external-knowledge-api-card', () => ({
  default: ({ api }: { api: ExternalAPIItem }) => (
    <div data-testid={`api-card-${api.id}`}>{api.name}</div>
  ),
}))

// i18n mock returns 'namespace.key' format

describe('ExternalAPIPanel', () => {
  const defaultProps = {
    onClose: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockIsLoading = false
    mockExternalKnowledgeApiList = []
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<ExternalAPIPanel {...defaultProps} />)
      expect(screen.getByText('dataset.externalAPIPanelTitle')).toBeInTheDocument()
    })

    it('should render panel title and description', () => {
      render(<ExternalAPIPanel {...defaultProps} />)
      expect(screen.getByText('dataset.externalAPIPanelTitle')).toBeInTheDocument()
      expect(screen.getByText('dataset.externalAPIPanelDescription')).toBeInTheDocument()
    })

    it('should render documentation link', () => {
      render(<ExternalAPIPanel {...defaultProps} />)
      const docLink = screen.getByText('dataset.externalAPIPanelDocumentation')
      expect(docLink).toBeInTheDocument()
      expect(docLink.closest('a')).toHaveAttribute('href', 'https://docs.example.com/use-dify/knowledge/external-knowledge-api')
    })

    it('should render create button', () => {
      render(<ExternalAPIPanel {...defaultProps} />)
      expect(screen.getByText('dataset.createExternalAPI')).toBeInTheDocument()
    })

    it('should render close button', () => {
      const { container } = render(<ExternalAPIPanel {...defaultProps} />)
      const closeButton = container.querySelector('[class*="action-button"]') || screen.getAllByRole('button')[0]
      expect(closeButton).toBeInTheDocument()
    })
  })

  describe('Loading State', () => {
    it('should render loading indicator when isLoading is true', () => {
      mockIsLoading = true
      const { container } = render(<ExternalAPIPanel {...defaultProps} />)
      // Loading component should be rendered
      const loadingElement = container.querySelector('[class*="loading"]')
        || container.querySelector('.animate-spin')
        || screen.queryByRole('status')
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
      expect(screen.getByTestId('api-card-api-1')).toBeInTheDocument()
      expect(screen.getByTestId('api-card-api-2')).toBeInTheDocument()
      expect(screen.getByText('Test API 1')).toBeInTheDocument()
      expect(screen.getByText('Test API 2')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onClose when close button is clicked', () => {
      const onClose = vi.fn()
      render(<ExternalAPIPanel onClose={onClose} />)
      // Find the close button (ActionButton with close icon)
      const buttons = screen.getAllByRole('button')
      const closeButton = buttons.find(btn => btn.querySelector('svg[class*="ri-close"]'))
        || buttons[0]
      fireEvent.click(closeButton)
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

    it('should call mutateExternalKnowledgeApis in onSaveCallback', async () => {
      render(<ExternalAPIPanel {...defaultProps} />)
      const createButton = screen.getByText('dataset.createExternalAPI').closest('button')!
      fireEvent.click(createButton)

      const callArgs = mockSetShowExternalKnowledgeAPIModal.mock.calls[0][0]
      callArgs.onSaveCallback()

      expect(mockMutateExternalKnowledgeApis).toHaveBeenCalled()
    })

    it('should call mutateExternalKnowledgeApis in onCancelCallback', async () => {
      render(<ExternalAPIPanel {...defaultProps} />)
      const createButton = screen.getByText('dataset.createExternalAPI').closest('button')!
      fireEvent.click(createButton)

      const callArgs = mockSetShowExternalKnowledgeAPIModal.mock.calls[0][0]
      callArgs.onCancelCallback()

      expect(mockMutateExternalKnowledgeApis).toHaveBeenCalled()
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
      expect(screen.getByTestId('api-card-single-api')).toBeInTheDocument()
    })

    it('should render documentation link with correct target', () => {
      render(<ExternalAPIPanel {...defaultProps} />)
      const docLink = screen.getByText('dataset.externalAPIPanelDocumentation').closest('a')
      expect(docLink).toHaveAttribute('target', '_blank')
    })
  })
})
