import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import {
  useDatasetAccessRules,
  useDatasetUserAccessSettings,
  useRemoveDatasetAccessPolicyMemberBindings,
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
    queryFn: vi.fn().mockResolvedValue({ data: [], scope: 'specific' }),
  })),
  userAccessSettingsKey: vi.fn(() => ['rbac-access-config', 'datasets', 'user-access-settings']),
  userAccessSettingsQueryKey: vi.fn(() => ['rbac-access-config', 'datasets', 'user-access-settings', 'dataset-1']),
  updateOpenScope: vi.fn().mockResolvedValue({}),
  updateUserAccessSettings: vi.fn().mockResolvedValue({}),
  removeMemberBindings: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/service/client', () => ({
  consoleClient: {
    workspaces: {
      current: {
        rbac: {
          datasets: {
            byDatasetId: {
              accessPolicies: {
                byPolicyId: {
                  memberBindings: {
                    delete: mocks.removeMemberBindings,
                  },
                },
              },
              users: {
                byTargetAccountId: {
                  accessPolicies: {
                    put: mocks.updateUserAccessSettings,
                  },
                },
              },
              whitelist: {
                put: mocks.updateOpenScope,
              },
            },
          },
        },
      },
    },
  },
  consoleQuery: {
    workspaces: {
      current: {
        rbac: {
          datasets: {
            byDatasetId: {
              accessPolicy: {
                get: {
                  key: mocks.accessRulesKey,
                  queryOptions: mocks.accessRulesQueryOptions,
                },
              },
              userAccessPolicies: {
                get: {
                  key: mocks.userAccessSettingsKey,
                  queryKey: mocks.userAccessSettingsQueryKey,
                  queryOptions: mocks.userAccessSettingsQueryOptions,
                },
              },
            },
          },
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
            dataset_id: 'dataset-1',
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
      renderHook(() => useDatasetUserAccessSettings('dataset-1', 'zh'), { wrapper: createWrapper() })

      expect(mocks.userAccessSettingsQueryOptions).toHaveBeenCalledWith({
        input: {
          params: {
            dataset_id: 'dataset-1',
          },
          query: {
            language: 'zh',
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
          dataset_id: 'dataset-1',
          target_account_id: 'account-1',
        },
        body: {
          access_policy_ids: ['policy-1', 'policy-2'],
        },
      })
      expect(mocks.userAccessSettingsKey).toHaveBeenCalled()
      expect(mocks.accessRulesKey).toHaveBeenCalled()
    })

    it('should remove dataset access policy member bindings for account ids', async () => {
      const { result } = renderHook(() => useRemoveDatasetAccessPolicyMemberBindings('dataset-1'), { wrapper: createWrapper() })

      await act(async () => {
        await result.current.mutateAsync({ accessPolicyId: 'policy-1', accountIds: ['account-1'] })
      })

      expect(mocks.removeMemberBindings).toHaveBeenCalledWith({
        params: {
          dataset_id: 'dataset-1',
          policy_id: 'policy-1',
        },
        body: {
          account_ids: ['account-1'],
        },
      })
      expect(mocks.userAccessSettingsKey).toHaveBeenCalled()
      expect(mocks.accessRulesKey).toHaveBeenCalled()
    })

    it('should update open scope for a dataset id', async () => {
      const { result } = renderHook(() => useUpdateDatasetOpenScope('dataset-1'), { wrapper: createWrapper() })

      await act(async () => {
        await result.current.mutateAsync('specific')
      })

      expect(mocks.updateOpenScope).toHaveBeenCalledWith({
        params: {
          dataset_id: 'dataset-1',
        },
        body: {
          scope: 'specific',
        },
      })
      expect(mocks.userAccessSettingsKey).toHaveBeenCalled()
    })
  })
})
