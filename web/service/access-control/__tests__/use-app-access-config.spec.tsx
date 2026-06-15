import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { get } from '@/service/base'
import { useAppAccessRules } from '../use-app-access-config'

vi.mock('@/service/base', () => ({
  get: vi.fn(),
}))

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('use-app-access-config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(get).mockResolvedValue({ app_id: 'app-1', items: [] })
  })

  // Queries load app-specific access policies from the RBAC app route.
  describe('Queries', () => {
    it('should fetch access rules for an app id', async () => {
      renderHook(() => useAppAccessRules('app-1', 'zh'), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(get).toHaveBeenCalledWith('/workspaces/current/rbac/apps/app-1/access-policy', {
          params: { language: 'zh' },
        })
      })
    })
  })
})
