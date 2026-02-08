import type { ExternalAPIItem } from '@/models/datasets'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
// Import mocked services
import { checkUsageExternalAPI, deleteExternalAPI, fetchExternalAPI } from '@/service/datasets'

import ExternalKnowledgeAPICard from './index'

// Mock API services
vi.mock('@/service/datasets', () => ({
  fetchExternalAPI: vi.fn(),
  updateExternalAPI: vi.fn(),
  deleteExternalAPI: vi.fn(),
  checkUsageExternalAPI: vi.fn(),
}))

// Mock contexts
const mockSetShowExternalKnowledgeAPIModal = vi.fn()
const mockMutateExternalKnowledgeApis = vi.fn()

vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({
    setShowExternalKnowledgeAPIModal: mockSetShowExternalKnowledgeAPIModal,
  }),
}))

vi.mock('@/context/external-knowledge-api-context', () => ({
  useExternalKnowledgeApi: () => ({
    mutateExternalKnowledgeApis: mockMutateExternalKnowledgeApis,
  }),
}))

describe('ExternalKnowledgeAPICard', () => {
  const mockApi: ExternalAPIItem = {
    id: 'api-123',
    tenant_id: 'tenant-1',
    name: 'Test External API',
    description: 'Test API description',
    settings: {
      endpoint: 'https://api.example.com/knowledge',
      api_key: 'secret-key-123',
    },
    dataset_bindings: [],
    created_by: 'user-1',
    created_at: '2021-01-01T00:00:00Z',
  }

  const defaultProps = {
    api: mockApi,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<ExternalKnowledgeAPICard {...defaultProps} />)
      expect(screen.getByText('Test External API')).toBeInTheDocument()
    })

    it('should render API name', () => {
      render(<ExternalKnowledgeAPICard {...defaultProps} />)
      expect(screen.getByText('Test External API')).toBeInTheDocument()
    })

    it('should render API endpoint', () => {
      render(<ExternalKnowledgeAPICard {...defaultProps} />)
      expect(screen.getByText('https://api.example.com/knowledge')).toBeInTheDocument()
    })

    it('should render edit and delete buttons', () => {
      const { container } = render(<ExternalKnowledgeAPICard {...defaultProps} />)
      const buttons = container.querySelectorAll('button')
      expect(buttons.length).toBe(2)
    })

    it('should render API connection icon', () => {
      const { container } = render(<ExternalKnowledgeAPICard {...defaultProps} />)
      const icon = container.querySelector('svg')
      expect(icon).toBeInTheDocument()
    })
  })

  describe('User Interactions - Edit', () => {
    it('should fetch API details and open modal when edit button is clicked', async () => {
      const mockResponse: ExternalAPIItem = {
        id: 'api-123',
        tenant_id: 'tenant-1',
        name: 'Test External API',
        description: 'Test API description',
        settings: {
          endpoint: 'https://api.example.com/knowledge',
          api_key: 'secret-key-123',
        },
        dataset_bindings: [{ id: 'ds-1', name: 'Dataset 1' }],
        created_by: 'user-1',
        created_at: '2021-01-01T00:00:00Z',
      }
      vi.mocked(fetchExternalAPI).mockResolvedValue(mockResponse)

      const { container } = render(<ExternalKnowledgeAPICard {...defaultProps} />)
      const buttons = container.querySelectorAll('button')
      const editButton = buttons[0]

      fireEvent.click(editButton)

      await waitFor(() => {
        expect(fetchExternalAPI).toHaveBeenCalledWith({ apiTemplateId: 'api-123' })
        expect(mockSetShowExternalKnowledgeAPIModal).toHaveBeenCalledWith(
          expect.objectContaining({
            payload: {
              name: 'Test External API',
              settings: {
                endpoint: 'https://api.example.com/knowledge',
                api_key: 'secret-key-123',
              },
            },
            isEditMode: true,
            datasetBindings: [{ id: 'ds-1', name: 'Dataset 1' }],
          }),
        )
      })
    })

    it('should handle fetch error gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.mocked(fetchExternalAPI).mockRejectedValue(new Error('Fetch failed'))

      const { container } = render(<ExternalKnowledgeAPICard {...defaultProps} />)
      const buttons = container.querySelectorAll('button')
      const editButton = buttons[0]

      fireEvent.click(editButton)

      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith(
          'Error fetching external knowledge API data:',
          expect.any(Error),
        )
      })

      consoleSpy.mockRestore()
    })

    it('should call mutate on save callback', async () => {
      const mockResponse: ExternalAPIItem = {
        id: 'api-123',
        tenant_id: 'tenant-1',
        name: 'Test External API',
        description: 'Test API description',
        settings: {
          endpoint: 'https://api.example.com/knowledge',
          api_key: 'secret-key-123',
        },
        dataset_bindings: [],
        created_by: 'user-1',
        created_at: '2021-01-01T00:00:00Z',
      }
      vi.mocked(fetchExternalAPI).mockResolvedValue(mockResponse)

      const { container } = render(<ExternalKnowledgeAPICard {...defaultProps} />)
      const editButton = container.querySelectorAll('button')[0]

      fireEvent.click(editButton)

      await waitFor(() => {
        expect(mockSetShowExternalKnowledgeAPIModal).toHaveBeenCalled()
      })

      // Simulate save callback
      const modalCall = mockSetShowExternalKnowledgeAPIModal.mock.calls[0][0]
      modalCall.onSaveCallback()

      expect(mockMutateExternalKnowledgeApis).toHaveBeenCalled()
    })

    it('should call mutate on cancel callback', async () => {
      const mockResponse: ExternalAPIItem = {
        id: 'api-123',
        tenant_id: 'tenant-1',
        name: 'Test External API',
        description: 'Test API description',
        settings: {
          endpoint: 'https://api.example.com/knowledge',
          api_key: 'secret-key-123',
        },
        dataset_bindings: [],
        created_by: 'user-1',
        created_at: '2021-01-01T00:00:00Z',
      }
      vi.mocked(fetchExternalAPI).mockResolvedValue(mockResponse)

      const { container } = render(<ExternalKnowledgeAPICard {...defaultProps} />)
      const editButton = container.querySelectorAll('button')[0]

      fireEvent.click(editButton)

      await waitFor(() => {
        expect(mockSetShowExternalKnowledgeAPIModal).toHaveBeenCalled()
      })

      // Simulate cancel callback
      const modalCall = mockSetShowExternalKnowledgeAPIModal.mock.calls[0][0]
      modalCall.onCancelCallback()

      expect(mockMutateExternalKnowledgeApis).toHaveBeenCalled()
    })
  })

  describe('User Interactions - Delete', () => {
    it('should check usage and show confirm dialog when delete button is clicked', async () => {
      vi.mocked(checkUsageExternalAPI).mockResolvedValue({ is_using: false, count: 0 })

      const { container } = render(<ExternalKnowledgeAPICard {...defaultProps} />)
      const buttons = container.querySelectorAll('button')
      const deleteButton = buttons[1]

      fireEvent.click(deleteButton)

      await waitFor(() => {
        expect(checkUsageExternalAPI).toHaveBeenCalledWith({ apiTemplateId: 'api-123' })
      })

      // Confirm dialog should be shown
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
      })
    })

    it('should show usage count in confirm dialog when API is in use', async () => {
      vi.mocked(checkUsageExternalAPI).mockResolvedValue({ is_using: true, count: 3 })

      const { container } = render(<ExternalKnowledgeAPICard {...defaultProps} />)
      const deleteButton = container.querySelectorAll('button')[1]

      fireEvent.click(deleteButton)

      await waitFor(() => {
        expect(screen.getByText(/3/)).toBeInTheDocument()
      })
    })

    it('should delete API and refresh list when confirmed', async () => {
      vi.mocked(checkUsageExternalAPI).mockResolvedValue({ is_using: false, count: 0 })
      vi.mocked(deleteExternalAPI).mockResolvedValue({ result: 'success' })

      const { container } = render(<ExternalKnowledgeAPICard {...defaultProps} />)
      const deleteButton = container.querySelectorAll('button')[1]

      fireEvent.click(deleteButton)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument()
      })

      const confirmButton = screen.getByRole('button', { name: /confirm/i })
      fireEvent.click(confirmButton)

      await waitFor(() => {
        expect(deleteExternalAPI).toHaveBeenCalledWith({ apiTemplateId: 'api-123' })
        expect(mockMutateExternalKnowledgeApis).toHaveBeenCalled()
      })
    })

    it('should close confirm dialog when cancel is clicked', async () => {
      vi.mocked(checkUsageExternalAPI).mockResolvedValue({ is_using: false, count: 0 })

      const { container } = render(<ExternalKnowledgeAPICard {...defaultProps} />)
      const deleteButton = container.querySelectorAll('button')[1]

      fireEvent.click(deleteButton)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
      })

      const cancelButton = screen.getByRole('button', { name: /cancel/i })
      fireEvent.click(cancelButton)

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /confirm/i })).not.toBeInTheDocument()
      })
    })

    it('should handle delete error gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.mocked(checkUsageExternalAPI).mockResolvedValue({ is_using: false, count: 0 })
      vi.mocked(deleteExternalAPI).mockRejectedValue(new Error('Delete failed'))

      const { container } = render(<ExternalKnowledgeAPICard {...defaultProps} />)
      const deleteButton = container.querySelectorAll('button')[1]

      fireEvent.click(deleteButton)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument()
      })

      const confirmButton = screen.getByRole('button', { name: /confirm/i })
      fireEvent.click(confirmButton)

      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith(
          'Error deleting external knowledge API:',
          expect.any(Error),
        )
      })

      consoleSpy.mockRestore()
    })

    it('should handle check usage error gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.mocked(checkUsageExternalAPI).mockRejectedValue(new Error('Check failed'))

      const { container } = render(<ExternalKnowledgeAPICard {...defaultProps} />)
      const deleteButton = container.querySelectorAll('button')[1]

      fireEvent.click(deleteButton)

      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith(
          'Error checking external API usage:',
          expect.any(Error),
        )
      })

      consoleSpy.mockRestore()
    })
  })

  describe('Hover State', () => {
    it('should apply hover styles when delete button is hovered', () => {
      const { container } = render(<ExternalKnowledgeAPICard {...defaultProps} />)
      const deleteButton = container.querySelectorAll('button')[1]
      const cardContainer = container.querySelector('[class*="shadows-shadow"]')

      fireEvent.mouseEnter(deleteButton)
      expect(cardContainer).toHaveClass('border-state-destructive-border')
      expect(cardContainer).toHaveClass('bg-state-destructive-hover')

      fireEvent.mouseLeave(deleteButton)
      expect(cardContainer).not.toHaveClass('border-state-destructive-border')
    })
  })

  describe('Edge Cases', () => {
    it('should handle API with empty endpoint', () => {
      const apiWithEmptyEndpoint: ExternalAPIItem = {
        ...mockApi,
        settings: { endpoint: '', api_key: 'key' },
      }
      render(<ExternalKnowledgeAPICard api={apiWithEmptyEndpoint} />)
      expect(screen.getByText('Test External API')).toBeInTheDocument()
    })

    it('should handle delete response with unsuccessful result', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.mocked(checkUsageExternalAPI).mockResolvedValue({ is_using: false, count: 0 })
      vi.mocked(deleteExternalAPI).mockResolvedValue({ result: 'error' })

      const { container } = render(<ExternalKnowledgeAPICard {...defaultProps} />)
      const deleteButton = container.querySelectorAll('button')[1]

      fireEvent.click(deleteButton)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument()
      })

      const confirmButton = screen.getByRole('button', { name: /confirm/i })
      fireEvent.click(confirmButton)

      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith('Failed to delete external API')
      })

      consoleSpy.mockRestore()
    })
  })
})
