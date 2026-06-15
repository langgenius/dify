import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import {
  useDatasetAccessRules,
  useDatasetUserAccessSettings,
  useUpdateDatasetOpenScope,
  useUpdateDatasetUserAccessSettings,
} from '../use-dataset-access-config'

const mocks = vi.hoisted(() => ({
  accessRulesQueryOptions: vi.fn(() => ({
    queryKey: ['rbac-access-config', 'datasets', 'access-rules'],
    queryFn: vi.fn().mockResolvedValue({ dataset_id: 'dataset-1', items: [] }),
  })),
  accessRulesKey: vi.fn(() => ['rbac-access-config', 'datasets', 'access-rules']),
  userAccessSettingsQueryOptions: vi.fn(() => ({
    queryKey: ['rbac-access-config', 'datasets', 'user-access-settings'],
    queryFn: vi.fn().mockResolvedValue({ data: [] }),
  })),
  userAccessSettingsQueryKey: vi.fn(() => ['rbac-access-config', 'datasets', 'user-access-settings', 'dataset-1']),
  updateOpenScope: vi.fn().mockResolvedValue({}),
  updateUserAccessSettings: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/service/client', () => ({
  consoleClient: {
    rbacAccessConfig: {
      datasets: {
        updateOpenScope: mocks.updateOpenScope,
        updateUserAccessSettings: mocks.updateUserAccessSettings,
      },
    },
  },
  consoleQuery: {
    rbacAccessConfig: {
      datasets: {
        accessRules: {
          key: mocks.accessRulesKey,
          queryOptions: mocks.accessRulesQueryOptions,
        },
        userAccessSettings: {
          queryKey: mocks.userAccessSettingsQueryKey,
          queryOptions: mocks.userAccessSettingsQueryOptions,
        },
      },
    },
  },
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
  })

  // Queries load dataset-specific access policies from the RBAC dataset route.
  describe('Queries', () => {
    it('should fetch access rules for a dataset id', () => {
      renderHook(() => useDatasetAccessRules('dataset-1', 'ja'), { wrapper: createWrapper() })

      expect(mocks.accessRulesQueryOptions).toHaveBeenCalledWith({
        input: {
          params: {
            datasetId: 'dataset-1',
          },
          query: {
            language: 'ja',
          },
        },
      })
    })
  })

  // User access settings mirror the app access-config API shape for datasets.
  describe('User Access Settings', () => {
    it('should fetch user access settings for a dataset id', () => {
      renderHook(() => useDatasetUserAccessSettings('dataset-1'), { wrapper: createWrapper() })

      expect(mocks.userAccessSettingsQueryOptions).toHaveBeenCalledWith({
        input: {
          params: {
            datasetId: 'dataset-1',
          },
        },
      })
    })

    it('should update user access settings for a dataset id', async () => {
      const { result } = renderHook(() => useUpdateDatasetUserAccessSettings('dataset-1'), { wrapper: createWrapper() })

      await act(async () => {
        await result.current.mutateAsync({ accountId: 'account-1', accessPolicyIds: ['policy-1', 'policy-2'] })
      })

      expect(mocks.updateUserAccessSettings).toHaveBeenCalledWith({
        params: {
          datasetId: 'dataset-1',
          accountId: 'account-1',
        },
        body: {
          access_policy_ids: ['policy-1', 'policy-2'],
        },
      })
      expect(mocks.userAccessSettingsQueryKey).toHaveBeenCalledWith({
        input: {
          params: {
            datasetId: 'dataset-1',
          },
        },
      })
      expect(mocks.accessRulesKey).toHaveBeenCalled()
    })

    it('should update open scope for a dataset id', async () => {
      const { result } = renderHook(() => useUpdateDatasetOpenScope('dataset-1'), { wrapper: createWrapper() })

      await act(async () => {
        await result.current.mutateAsync('specific')
      })

      expect(mocks.updateOpenScope).toHaveBeenCalledWith({
        params: {
          datasetId: 'dataset-1',
        },
        body: {
          scope: 'specific',
        },
      })
      expect(mocks.userAccessSettingsQueryKey).toHaveBeenCalledWith({
        input: {
          params: {
            datasetId: 'dataset-1',
          },
        },
      })
    })
  })
})
