import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import { createElement } from 'react'
import { usePreImportNotionPages } from './use-import'

const mockGet = vi.hoisted(() => vi.fn())

vi.mock('../base', () => ({
  get: mockGet,
}))

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)
}

describe('usePreImportNotionPages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockResolvedValue({ notion_info: [], next_cursor: null })
  })

  it('should request paginated pre-import pages', async () => {
    renderHook(
      () => usePreImportNotionPages({ datasetId: 'dataset-1', credentialId: 'credential-1' }),
      { wrapper: createWrapper() },
    )

    await vi.waitFor(() => {
      expect(mockGet).toHaveBeenCalled()
    })

    expect(mockGet).toHaveBeenCalledWith('/notion/pre-import/pages', {
      params: {
        dataset_id: 'dataset-1',
        credential_id: 'credential-1',
        page_size: 50,
      },
    })
  })

  it('should not fetch when credential id is empty', () => {
    renderHook(() => usePreImportNotionPages({ datasetId: 'dataset-1', credentialId: '' }), {
      wrapper: createWrapper(),
    })

    expect(mockGet).not.toHaveBeenCalled()
  })
})
