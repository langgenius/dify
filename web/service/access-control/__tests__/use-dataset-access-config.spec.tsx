import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { get, put } from '@/service/base'
import {
  useDatasetAccessRules,
  useDatasetUserAccessSettings,
  useUpdateDatasetOpenScope,
  useUpdateDatasetUserAccessSettings,
} from '../use-dataset-access-config'

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
      renderHook(() => useDatasetAccessRules('dataset-1', 'ja'), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(get).toHaveBeenCalledWith('/workspaces/current/rbac/datasets/dataset-1/access-policy', {
          params: { language: 'ja' },
        })
      })
    })
  })

  // User access settings mirror the app access-config API shape for datasets.
  describe('User Access Settings', () => {
    it('should fetch user access settings for a dataset id', async () => {
      renderHook(() => useDatasetUserAccessSettings('dataset-1'), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(get).toHaveBeenCalledWith('/datasets/dataset-1/user-access-policies')
      })
    })

    it('should update user access settings for a dataset id', async () => {
      const { result } = renderHook(() => useUpdateDatasetUserAccessSettings('dataset-1'), { wrapper: createWrapper() })

      await act(async () => {
        await result.current.mutateAsync({ accessPolicyIds: ['policy-1', 'policy-2'] })
      })

      expect(put).toHaveBeenCalledWith('/datasets/dataset-1/user-access-policies', {
        body: {
          access_policy_ids: ['policy-1', 'policy-2'],
        },
      })
    })

    it('should update open scope for a dataset id', async () => {
      const { result } = renderHook(() => useUpdateDatasetOpenScope('dataset-1'), { wrapper: createWrapper() })

      await act(async () => {
        await result.current.mutateAsync('specific')
      })

      expect(put).toHaveBeenCalledWith('/datasets/dataset-1/open-scope', {
        body: {
          scope: 'specific',
        },
      })
    })
  })
})
