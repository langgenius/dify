import { DataType } from '@/app/components/datasets/metadata/types'
import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useBatchUpdateDocMetadata } from '@/service/knowledge/use-metadata'
import { useDocumentListKey } from './use-document'

// Mock the post function to avoid real network requests
jest.mock('@/service/base', () => ({
  post: jest.fn().mockResolvedValue({ success: true }),
}))

const NAME_SPACE = 'dataset-metadata'

describe('useBatchUpdateDocMetadata', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    // Create a fresh QueryClient before each test
    queryClient = new QueryClient()
  })

  // Wrapper for React Query context
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )

  it('should correctly invalidate dataset and document caches', async () => {
    const { result } = renderHook(() => useBatchUpdateDocMetadata(), { wrapper })

    // Spy on queryClient.invalidateQueries
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries')

    // Correct payload type: each document has its own metadata_list array

    const payload = {
      dataset_id: 'dataset-1',
      metadata_list: [
        {
          document_id: 'doc-1',
          metadata_list: [
            { key: 'title-1', id: '01', name: 'name-1', type: DataType.string, value: 'new title 01' },
          ],
        },
        {
          document_id: 'doc-2',
          metadata_list: [
            { key: 'title-2', id: '02', name: 'name-1', type: DataType.string, value: 'new title 02' },
          ],
        },
      ],
    }

    // Execute the mutation
    await act(async () => {
      await result.current.mutateAsync(payload)
    })

    // Expect invalidateQueries to have been called exactly 5 times
    expect(invalidateSpy).toHaveBeenCalledTimes(5)

    // Dataset cache invalidation
    expect(invalidateSpy).toHaveBeenNthCalledWith(1, {
      queryKey: [NAME_SPACE, 'dataset', 'dataset-1'],
    })

    // Document list cache invalidation
    expect(invalidateSpy).toHaveBeenNthCalledWith(2, {
      queryKey: [NAME_SPACE, 'document', 'dataset-1'],
    })

    // useDocumentListKey cache invalidation
    expect(invalidateSpy).toHaveBeenNthCalledWith(3, {
      queryKey: [...useDocumentListKey, 'dataset-1'],
    })

    // Single document cache invalidation
    expect(invalidateSpy.mock.calls.slice(3)).toEqual(
      expect.arrayContaining([
        [{ queryKey: [NAME_SPACE, 'document', 'dataset-1', 'doc-1'] }],
        [{ queryKey: [NAME_SPACE, 'document', 'dataset-1', 'doc-2'] }],
      ]),
    )
  })
})
