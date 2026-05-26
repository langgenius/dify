import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { get, put } from '@/service/base'
import { useAppAccessRules, useUpdateAppAccessRuleBindings } from '../use-app-access-config'

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
      renderHook(() => useAppAccessRules('app-1'), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(get).toHaveBeenCalledWith('/workspaces/current/rbac/apps/app-1/access-policy')
      })
    })
  })

  // Mutations update app bindings without leaking the route identifiers into the body.
  describe('Mutations', () => {
    it('should update app access rule bindings with body payload only', async () => {
      const { result } = renderHook(() => useUpdateAppAccessRuleBindings(), { wrapper: createWrapper() })

      await act(async () => {
        await result.current.mutateAsync({
          appId: 'app-1',
          policyId: 'policy-1',
          role_ids: ['role-1'],
          account_ids: ['account-1'],
        })
      })

      expect(put).toHaveBeenCalledWith('/workspaces/current/rbac/apps/app-1/access-policies/policy-1/bindings', {
        body: {
          role_ids: ['role-1'],
          account_ids: ['account-1'],
        },
      })
    })
  })
})
