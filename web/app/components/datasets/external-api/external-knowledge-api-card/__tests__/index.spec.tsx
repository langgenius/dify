import type { ExternalKnowledgeApiResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { consoleQuery } from '@/service/console'
// Import mocked services
import {
  checkUsageExternalAPI,
  deleteExternalAPI,
  fetchExternalAPI,
  updateExternalAPI,
} from '@/service/datasets'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
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
const externalKnowledgeApiQueryKey = consoleQuery.datasets.externalKnowledgeApi.get.queryOptions({
  input: {},
}).queryKey
let queryClient: ReturnType<typeof createConsoleQueryClient>
const render = (ui: React.ReactElement) => {
  queryClient = createConsoleQueryClient()
  queryClient.setQueryData(externalKnowledgeApiQueryKey, {
    data: [],
    has_more: false,
    page: 1,
    limit: 20,
    total: 0,
  })
  return renderWithConsoleQuery(ui, { queryClient })
}

vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({
    setShowExternalKnowledgeAPIModal: mockSetShowExternalKnowledgeAPIModal,
  }),
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
    it('targets the correct API when cards have duplicate names and endpoints', async () => {
      vi.mocked(checkUsageExternalAPI).mockResolvedValue({ is_using: false, count: 0 })
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

      await userEvent.setup().click(
        screen.getByRole('button', {
          name: 'common.operation.delete Test External API https://api.example.com/knowledge 2',
        }),
      )
      expect(checkUsageExternalAPI).toHaveBeenCalledWith({ apiTemplateId: 'api-456' })
      expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    })

    it('should hide edit and delete buttons when external knowledge API management is unavailable', () => {
      render(<ExternalKnowledgeAPICard {...defaultProps} canManageExternalKnowledgeApi={false} />)

      expect(screen.queryByRole('button', { name: editButtonName })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: deleteButtonName })).not.toBeInTheDocument()
    })
  })

  describe('User Interactions - Edit', () => {
    it('should fetch API details and open modal when edit button is clicked', async () => {
      const mockResponse: ExternalKnowledgeApiResponse = {
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

      await userEvent.setup().click(editButton!)

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

      await userEvent.setup().click(editButton!)

      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith(
          'Error fetching external knowledge API data:',
          expect.any(Error),
        )
      })

      expect(queryClient.getQueryState(externalKnowledgeApiQueryKey)?.isInvalidated).toBe(false)
      consoleSpy.mockRestore()
    })

    it('should invalidate the generated list query after editing', async () => {
      const mockResponse: ExternalKnowledgeApiResponse = {
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

      await userEvent.setup().click(editButton!)

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
      expect(queryClient.getQueryState(externalKnowledgeApiQueryKey)?.isInvalidated).toBe(true)
    })
  })

  describe('User Interactions - Delete', () => {
    it('should show usage count in confirm dialog when API is in use', async () => {
      vi.mocked(checkUsageExternalAPI).mockResolvedValue({ is_using: true, count: 3 })

      render(<ExternalKnowledgeAPICard {...defaultProps} />)
      const deleteButton = screen.getByRole('button', { name: deleteButtonName })

      await userEvent.setup().click(deleteButton!)

      await waitFor(() => {
        expect(screen.getByText(/3/))!.toBeInTheDocument()
      })
    })

    it('should delete API and refresh list when confirmed', async () => {
      vi.mocked(checkUsageExternalAPI).mockResolvedValue({ is_using: false, count: 0 })
      vi.mocked(deleteExternalAPI).mockResolvedValue({ result: 'success' })

      render(<ExternalKnowledgeAPICard {...defaultProps} />)
      const deleteButton = screen.getByRole('button', { name: deleteButtonName })

      await userEvent.setup().click(deleteButton!)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /confirm/i }))!.toBeInTheDocument()
      })

      const confirmButton = screen.getByRole('button', { name: /confirm/i })
      await userEvent.setup().click(confirmButton)

      await waitFor(() => {
        expect(deleteExternalAPI).toHaveBeenCalledWith({ apiTemplateId: 'api-123' })
        expect(queryClient.getQueryState(externalKnowledgeApiQueryKey)?.isInvalidated).toBe(true)
      })
    })

    it('should close confirm dialog when cancel is clicked', async () => {
      vi.mocked(checkUsageExternalAPI).mockResolvedValue({ is_using: false, count: 0 })

      render(<ExternalKnowledgeAPICard {...defaultProps} />)
      const deleteButton = screen.getByRole('button', { name: deleteButtonName })

      await userEvent.setup().click(deleteButton!)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /cancel/i }))!.toBeInTheDocument()
      })

      const cancelButton = screen.getByRole('button', { name: /cancel/i })
      await userEvent.setup().click(cancelButton)

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /confirm/i })).not.toBeInTheDocument()
        expect(deleteExternalAPI).not.toHaveBeenCalled()
        expect(queryClient.getQueryState(externalKnowledgeApiQueryKey)?.isInvalidated).toBe(false)
      })
    })

    it('should handle delete error gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.mocked(checkUsageExternalAPI).mockResolvedValue({ is_using: false, count: 0 })
      vi.mocked(deleteExternalAPI).mockRejectedValue(new Error('Delete failed'))

      render(<ExternalKnowledgeAPICard {...defaultProps} />)
      const deleteButton = screen.getByRole('button', { name: deleteButtonName })

      await userEvent.setup().click(deleteButton!)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /confirm/i }))!.toBeInTheDocument()
      })

      const confirmButton = screen.getByRole('button', { name: /confirm/i })
      await userEvent.setup().click(confirmButton)

      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith(
          'Error deleting external knowledge API:',
          expect.any(Error),
        )
      })

      expect(queryClient.getQueryState(externalKnowledgeApiQueryKey)?.isInvalidated).toBe(false)
      consoleSpy.mockRestore()
    })

    it('should handle check usage error gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.mocked(checkUsageExternalAPI).mockRejectedValue(new Error('Check failed'))

      render(<ExternalKnowledgeAPICard {...defaultProps} />)
      const deleteButton = screen.getByRole('button', { name: deleteButtonName })

      await userEvent.setup().click(deleteButton!)

      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith(
          'Error checking external API usage:',
          expect.any(Error),
        )
      })

      expect(queryClient.getQueryState(externalKnowledgeApiQueryKey)?.isInvalidated).toBe(false)
      consoleSpy.mockRestore()
    })
  })
})
