import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { get, put } from '@/service/base'
import {
  useAppAccessRules,
  useAppUserAccessSettings,
  useUpdateAppOpenScope,
  useUpdateAppUserAccessSettings,
} from '../use-app-access-config'

vi.mock('@/service/base', () => ({
  get: vi.fn(),
  put: vi.fn(),
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
    vi.mocked(put).mockResolvedValue({})
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

  // User access settings configure which access policies apply to app users.
  describe('User Access Settings', () => {
    it('should fetch user access settings for an app id', async () => {
      renderHook(() => useAppUserAccessSettings('app-1'), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(get).toHaveBeenCalledWith('/apps/app-1/user-access-policies')
      })
    })

    it('should update user access settings for an app id', async () => {
      const { result } = renderHook(() => useUpdateAppUserAccessSettings('app-1'), { wrapper: createWrapper() })

      await act(async () => {
        await result.current.mutateAsync({ accessPolicyIds: ['policy-1', 'policy-2'] })
      })

      expect(put).toHaveBeenCalledWith('/apps/app-1/user-access-policies', {
        body: {
          access_policy_ids: ['policy-1', 'policy-2'],
        },
      })
    })

    it('should update open scope for an app id', async () => {
      const { result } = renderHook(() => useUpdateAppOpenScope('app-1'), { wrapper: createWrapper() })

      await act(async () => {
        await result.current.mutateAsync('all')
      })

      expect(put).toHaveBeenCalledWith('/apps/app-1/open-scope', {
        body: {
          scope: 'all',
        },
      })
    })
  })
})
