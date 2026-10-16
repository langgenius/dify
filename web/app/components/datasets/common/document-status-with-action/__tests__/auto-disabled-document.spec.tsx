import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import AutoDisabledDocument from '../auto-disabled-document'

const { mockToastSuccess, mockEnableDocuments } = vi.hoisted(() => ({
  mockToastSuccess: vi.fn(),
  mockEnableDocuments: vi.fn(),
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const { mockConsoleOperationHooks } = await import('@/test/console/operation-hooks')
  return mockConsoleOperationHooks(await importOriginal(), {
    'datasets.byDatasetId.documents.status.byAction.batch.patch': () => ({
      mutateAsync: mockEnableDocuments,
    }),
  })
})

vi.mock('@/app/notifications', () => ({
  toast: {
    success: mockToastSuccess,
  },
}))

const autoDisableLogsKey = (datasetId: string) =>
  consoleQuery.datasets.byDatasetId.autoDisableLogs.get.queryKey({
    input: { params: { dataset_id: datasetId } },
  })

const renderWithDisabledDocuments = (datasetId: string, documentIds?: string[]) => {
  const queryClient = createConsoleQueryClient()
  if (documentIds) {
    queryClient.setQueryData(autoDisableLogsKey(datasetId), {
      document_ids: documentIds,
      count: documentIds.length,
    })
  }
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue()
  return {
    ...renderWithConsoleQuery(<AutoDisabledDocument datasetId={datasetId} />, { queryClient }),
    invalidateQueries,
  }
}

describe('AutoDisabledDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnableDocuments.mockResolvedValue({ result: 'success' })
  })

  describe('Rendering', () => {
    it('should render nothing while the disabled documents are loading', () => {
      vi.mocked(globalThis.fetch).mockImplementationOnce(() => new Promise<Response>(() => {}))
      const { container } = renderWithDisabledDocuments('test-dataset')
      expect(container.firstChild).toBeNull()
    })

    it('should render nothing when no documents were disabled', () => {
      const { container } = renderWithDisabledDocuments('test-dataset', [])
      expect(container.firstChild).toBeNull()
    })

    it('should offer to enable the disabled documents', async () => {
      renderWithDisabledDocuments('test-dataset', ['doc1', 'doc2'])
      expect(await screen.findByRole('button', { name: /enable/i })).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should enable every disabled document of the dataset', async () => {
      const user = userEvent.setup()
      renderWithDisabledDocuments('test-dataset', ['doc1', 'doc2'])

      await user.click(await screen.findByRole('button', { name: /enable/i }))

      expect(mockEnableDocuments).toHaveBeenCalledWith({
        params: { dataset_id: 'test-dataset', action: 'enable' },
        query: { document_id: ['doc1', 'doc2'] },
      })
    })

    it('should refresh the disabled documents and confirm after enabling', async () => {
      const user = userEvent.setup()
      const { invalidateQueries } = renderWithDisabledDocuments('test-dataset', ['doc1'])

      await user.click(await screen.findByRole('button', { name: /enable/i }))

      await waitFor(() => {
        expect(invalidateQueries).toHaveBeenCalledWith({
          queryKey: autoDisableLogsKey('test-dataset'),
        })
      })
      expect(toast.success).toHaveBeenCalledWith(expect.any(String))
    })
  })
})
