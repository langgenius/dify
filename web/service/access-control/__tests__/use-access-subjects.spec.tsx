import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { useSearchAccessSubjects } from '../use-access-subjects'

const mockSearchForWhilteListCandidates = vi.hoisted(() => vi.fn())

vi.mock('@/service/client', () => ({
  consoleClient: {
    enterprise: {
      webAppAuth: {
        searchForWhilteListCandidates: (...args: unknown[]) => mockSearchForWhilteListCandidates(...args),
      },
    },
  },
}))

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })

  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('use-access-subjects', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSearchForWhilteListCandidates.mockResolvedValue({
      currPage: 1,
      subjects: [],
      hasMore: false,
    })
  })

  it('should search access subject candidates with the generated enterprise client', async () => {
    renderHook(
      () => useSearchAccessSubjects({
        keyword: 'team one',
        groupId: 'group-1',
        resultsPerPage: 20,
      }, true),
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(mockSearchForWhilteListCandidates).toHaveBeenCalledWith({
        query: {
          keyword: 'team one',
          groupId: 'group-1',
          resultsPerPage: 20,
          pageNumber: 1,
        },
      })
    })
  })
})
