import type { ExternalKnowledgeApiResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { ExternalAPIItem } from '@/models/datasets'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
// Import mocked services
import {
  checkUsageExternalAPI,
  deleteExternalAPI,
  fetchExternalAPI,
  updateExternalAPI,
} from '@/service/datasets'
import ExternalKnowledgeAPICard from '../index'

// Mock API services
vi.mock('@/service/datasets', () => ({
  fetchExternalAPI: vi.fn(),
  updateExternalAPI: vi.fn(),
  deleteExternalAPI: vi.fn(),
  checkUsageExternalAPI: vi.fn(),
}))

// Mock contexts
const mockSetShowExternalKnowledgeAPIModal = vi.fn()
const mockInvalidateQueries = vi.fn()
const externalKnowledgeApiQueryKey = ['console', 'datasets', 'externalKnowledgeApi', 'get']

vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({
    setShowExternalKnowledgeAPIModal: mockSetShowExternalKnowledgeAPIModal,
  }),
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...original,
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

describe('ExternalKnowledgeAPICard', () => {
  const mockApi: ExternalKnowledgeApiResponse = {
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
    canManageExternalKnowledgeApi: true,
    position: 1,
  }

  const editButtonName =
    'common.operation.edit Test External API https://api.example.com/knowledge 1'
  const deleteButtonName =
    'common.operation.delete Test External API https://api.example.com/knowledge 1'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render API name', () => {
      render(<ExternalKnowledgeAPICard {...defaultProps} />)
      expect(screen.getByText('Test External API'))!.toBeInTheDocument()
    })

    it('should render API endpoint', () => {
      render(<ExternalKnowledgeAPICard {...defaultProps} />)
      expect(screen.getByText('https://api.example.com/knowledge'))!.toBeInTheDocument()
    })

    it('should render edit and delete buttons', () => {
      const duplicateApi = {
        ...mockApi,
        id: 'api-456',
      }

      render(
        <>
          <ExternalKnowledgeAPICard {...defaultProps} />
          <ExternalKnowledgeAPICard
            api={duplicateApi}
            canManageExternalKnowledgeApi={true}
            position={2}
          />
        </>,
      )

      expect(screen.getByRole('button', { name: editButtonName })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: deleteButtonName })).toBeInTheDocument()
      expect(
        screen.getByRole('button', {
          name: 'common.operation.edit Test External API https://api.example.com/knowledge 2',
        }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', {
          name: 'common.operation.delete Test External API https://api.example.com/knowledge 2',
        }),
      ).toBeInTheDocument()
    })

    it('should hide edit and delete buttons when external knowledge API management is unavailable', () => {
      render(<ExternalKnowledgeAPICard {...defaultProps} canManageExternalKnowledgeApi={false} />)

      expect(screen.queryByRole('button', { name: editButtonName })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: deleteButtonName })).not.toBeInTheDocument()
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

      render(<ExternalKnowledgeAPICard {...defaultProps} />)
      const editButton = screen.getByRole('button', { name: editButtonName })

      fireEvent.click(editButton!)

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

      render(<ExternalKnowledgeAPICard {...defaultProps} />)
      const editButton = screen.getByRole('button', { name: editButtonName })

      fireEvent.click(editButton!)

      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith(
          'Error fetching external knowledge API data:',
          expect.any(Error),
        )
      })

      consoleSpy.mockRestore()
    })

    it('should invalidate the generated list query after editing', async () => {
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

      render(<ExternalKnowledgeAPICard {...defaultProps} />)
      const editButton = screen.getByRole('button', { name: editButtonName })

      fireEvent.click(editButton!)

      await waitFor(() => {
        expect(mockSetShowExternalKnowledgeAPIModal).toHaveBeenCalled()
      })

      const modalCall = mockSetShowExternalKnowledgeAPIModal.mock.calls[0]![0]
      await modalCall.onEditCallback({
        name: 'Updated External API',
        settings: {
          endpoint: 'https://updated.example.com/knowledge',
          api_key: 'updated-secret-key',
        },
      })

      expect(updateExternalAPI).toHaveBeenCalledWith({
        apiTemplateId: 'api-123',
        body: expect.objectContaining({
          name: 'Updated External API',
          settings: {
            endpoint: 'https://updated.example.com/knowledge',
            api_key: 'updated-secret-key',
          },
        }),
      })
      expect(mockInvalidateQueries).toHaveBeenCalledWith({
        queryKey: externalKnowledgeApiQueryKey,
      })
    })

    it('should not refresh the list query when editing is canceled', async () => {
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

      render(<ExternalKnowledgeAPICard {...defaultProps} />)
      const editButton = screen.getByRole('button', { name: editButtonName })

      fireEvent.click(editButton!)

      await waitFor(() => {
        expect(mockSetShowExternalKnowledgeAPIModal).toHaveBeenCalled()
      })

      const modalCall = mockSetShowExternalKnowledgeAPIModal.mock.calls[0]![0]

      expect(modalCall.onCancelCallback).toBeUndefined()
      expect(mockInvalidateQueries).not.toHaveBeenCalled()
    })
  })

  describe('User Interactions - Delete', () => {
    it('should check usage and show confirm dialog when delete button is clicked', async () => {
      vi.mocked(checkUsageExternalAPI).mockResolvedValue({ is_using: false, count: 0 })

      render(<ExternalKnowledgeAPICard {...defaultProps} />)
      const deleteButton = screen.getByRole('button', { name: deleteButtonName })

      fireEvent.click(deleteButton!)

      await waitFor(() => {
        expect(checkUsageExternalAPI).toHaveBeenCalledWith({ apiTemplateId: 'api-123' })
      })

      // Confirm dialog should be shown
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /cancel/i }))!.toBeInTheDocument()
      })
    })

    it('should show usage count in confirm dialog when API is in use', async () => {
      vi.mocked(checkUsageExternalAPI).mockResolvedValue({ is_using: true, count: 3 })

      render(<ExternalKnowledgeAPICard {...defaultProps} />)
      const deleteButton = screen.getByRole('button', { name: deleteButtonName })

      fireEvent.click(deleteButton!)

      await waitFor(() => {
        expect(screen.getByText(/3/))!.toBeInTheDocument()
      })
    })

    it('should delete API and refresh list when confirmed', async () => {
      vi.mocked(checkUsageExternalAPI).mockResolvedValue({ is_using: false, count: 0 })
      vi.mocked(deleteExternalAPI).mockResolvedValue({ result: 'success' })

      render(<ExternalKnowledgeAPICard {...defaultProps} />)
      const deleteButton = screen.getByRole('button', { name: deleteButtonName })

      fireEvent.click(deleteButton!)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /confirm/i }))!.toBeInTheDocument()
      })

      const confirmButton = screen.getByRole('button', { name: /confirm/i })
      fireEvent.click(confirmButton)

      await waitFor(() => {
        expect(deleteExternalAPI).toHaveBeenCalledWith({ apiTemplateId: 'api-123' })
        expect(mockInvalidateQueries).toHaveBeenCalledWith({
          queryKey: externalKnowledgeApiQueryKey,
        })
      })
    })

    it('should close confirm dialog when cancel is clicked', async () => {
      vi.mocked(checkUsageExternalAPI).mockResolvedValue({ is_using: false, count: 0 })

      render(<ExternalKnowledgeAPICard {...defaultProps} />)
      const deleteButton = screen.getByRole('button', { name: deleteButtonName })

      fireEvent.click(deleteButton!)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /cancel/i }))!.toBeInTheDocument()
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

      render(<ExternalKnowledgeAPICard {...defaultProps} />)
      const deleteButton = screen.getByRole('button', { name: deleteButtonName })

      fireEvent.click(deleteButton!)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /confirm/i }))!.toBeInTheDocument()
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

      render(<ExternalKnowledgeAPICard {...defaultProps} />)
      const deleteButton = screen.getByRole('button', { name: deleteButtonName })

      fireEvent.click(deleteButton!)

      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith(
          'Error checking external API usage:',
          expect.any(Error),
        )
      })

      consoleSpy.mockRestore()
    })
  })

  describe('Edge Cases', () => {
    it('should handle API with empty endpoint', () => {
      const apiWithEmptyEndpoint: ExternalKnowledgeApiResponse = {
        ...mockApi,
        settings: { endpoint: '', api_key: 'key' },
      }
      render(
        <ExternalKnowledgeAPICard
          api={apiWithEmptyEndpoint}
          canManageExternalKnowledgeApi={true}
          position={1}
        />,
      )
      expect(screen.getByText('Test External API'))!.toBeInTheDocument()
    })

    it('should handle delete response with unsuccessful result', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.mocked(checkUsageExternalAPI).mockResolvedValue({ is_using: false, count: 0 })
      vi.mocked(deleteExternalAPI).mockResolvedValue({ result: 'error' })

      render(<ExternalKnowledgeAPICard {...defaultProps} />)
      const deleteButton = screen.getByRole('button', { name: deleteButtonName })

      fireEvent.click(deleteButton!)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /confirm/i }))!.toBeInTheDocument()
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
