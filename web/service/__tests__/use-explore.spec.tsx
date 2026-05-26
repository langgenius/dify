import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { fetchAppList } from '../explore'
import { useExploreAppList } from '../use-explore'

vi.mock('@/context/i18n', () => ({
  useLocale: () => 'en-US',
}))

vi.mock('../explore', () => ({
  fetchAppList: vi.fn(),
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

describe('useExploreAppList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fetchAppList).mockResolvedValue({
      categories: [],
      recommended_apps: [
        { id: 'app-2', position: 2 },
        { id: 'app-1', position: 1 },
      ],
    } as Awaited<ReturnType<typeof fetchAppList>>)
  })

  // Explore app list can now be disabled by callers.
  describe('Queries', () => {
    it('should not fetch app list when disabled', () => {
      renderHook(() => useExploreAppList({ enabled: false }), { wrapper: createWrapper() })

      expect(fetchAppList).not.toHaveBeenCalled()
    })

    it('should fetch localized app list and sort recommended apps by position', async () => {
      const { result } = renderHook(() => useExploreAppList({ enabled: true }), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(fetchAppList).toHaveBeenCalledWith('en-US')
      })
      await waitFor(() => {
        expect(result.current.data?.allList.map(app => app.id)).toEqual(['app-1', 'app-2'])
      })
    })
  })
})
