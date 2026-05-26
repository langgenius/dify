import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { get, put } from '@/service/base'
import { useDatasetAccessRules, useUpdateDatasetAccessRuleBindings } from '../use-dataset-access-config'

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

describe('use-dataset-access-config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(get).mockResolvedValue({ dataset_id: 'dataset-1', items: [] })
    vi.mocked(put).mockResolvedValue({})
  })

  // Queries load dataset-specific access policies from the RBAC dataset route.
  describe('Queries', () => {
    it('should fetch access rules for a dataset id', async () => {
      renderHook(() => useDatasetAccessRules('dataset-1'), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(get).toHaveBeenCalledWith('/workspaces/current/rbac/datasets/dataset-1/access-policy')
      })
    })
  })

  // Mutations update dataset bindings without leaking the route identifiers into the body.
  describe('Mutations', () => {
    it('should update dataset access rule bindings with body payload only', async () => {
      const { result } = renderHook(() => useUpdateDatasetAccessRuleBindings(), { wrapper: createWrapper() })

      await act(async () => {
        await result.current.mutateAsync({
          datasetId: 'dataset-1',
          policyId: 'policy-1',
          role_ids: ['role-1'],
          account_ids: ['account-1'],
        })
      })

      expect(put).toHaveBeenCalledWith('/workspaces/current/rbac/datasets/dataset-1/access-policies/policy-1/bindings', {
        body: {
          role_ids: ['role-1'],
          account_ids: ['account-1'],
        },
      })
    })
  })
})
