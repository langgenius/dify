import type { ReactNode } from 'react'
import type { App } from '@/models/explore'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { AppModeEnum } from '@/types/app'
import { fetchAppList } from '../explore'
import { useExploreAppList } from '../use-explore'

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

const createApp = (appId: string, position: number): App => ({
  app: {
    id: appId,
    mode: AppModeEnum.CHAT,
    icon_type: 'emoji',
    icon: 'robot',
    icon_background: '#fff',
    icon_url: '',
    name: appId,
    description: '',
    use_icon_as_answer_icon: false,
  },
  app_id: appId,
  description: '',
  copyright: '',
  privacy_policy: null,
  custom_disclaimer: null,
  categories: [],
  position,
  is_listed: true,
  install_count: 0,
  installed: false,
  editable: false,
  is_agent: false,
  can_trial: false,
})

describe('useExploreAppList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fetchAppList).mockResolvedValue({
      categories: [],
      recommended_apps: [createApp('app-2', 2), createApp('app-1', 1)],
    })
  })

  // Explore app list can now be disabled by callers.
  describe('Queries', () => {
    it('should not fetch app list when disabled', () => {
      renderHook(() => useExploreAppList({ enabled: false }), { wrapper: createWrapper() })

      expect(fetchAppList).not.toHaveBeenCalled()
    })

    it('should fetch localized app list and sort recommended apps by position', async () => {
      const { result } = renderHook(() => useExploreAppList({ enabled: true }), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(fetchAppList).toHaveBeenCalledWith('en-US')
      })
      await waitFor(() => {
        expect(result.current.data?.allList.map((app) => app.app_id)).toEqual(['app-1', 'app-2'])
      })
    })
  })
})
