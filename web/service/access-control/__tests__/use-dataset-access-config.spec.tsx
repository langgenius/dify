import type { DatasetAccessMatrix, ResourceUserAccessPoliciesResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import {
  useDatasetAccessRules,
  useDatasetUserAccessSettings,
  useRemoveDatasetAccessPolicyMemberBindings,
  useUpdateDatasetOpenScope,
  useUpdateDatasetUserAccessSettings,
} from '../use-dataset-access-config'

const mocks = vi.hoisted(() => {
  const accessRulesResponse = {
    dataset_id: 'dataset-1',
    items: [
      {
        policy: {
          id: 'policy-1',
          resource_type: 'dataset',
          name: 'Dataset policy',
          category: 'global_system_default',
          permission_keys: ['dataset:read'],
          is_builtin: true,
        },
        roles: [
          {
            role_id: 'role-1',
            role_name: 'Dataset operator',
            binding_id: 'binding-role-1',
          },
        ],
        accounts: [
          {
            account_id: 'account-1',
            account_name: 'Alice',
            binding_id: 'binding-account-1',
            avatar: 'avatar.png',
            is_locked: true,
          },
        ],
      },
    ],
  } satisfies DatasetAccessMatrix
  const userAccessSettingsResponse = {
    data: [
      {
        account: {
          account_id: 'account-1',
          account_name: 'Alice',
          email: 'alice@example.com',
        },
        roles: [
          {
            id: 'role-1',
            type: 'dataset',
            category: 'global_custom',
            name: 'Dataset operator',
            is_builtin: true,
          },
        ],
        access_policies: [
          {
            id: 'policy-1',
            resource_type: 'dataset',
            name: 'Dataset policy',
          },
        ],
      },
    ],
    scope: 'all',
  } satisfies ResourceUserAccessPoliciesResponse

  return {
    accessRulesResponse,
    userAccessSettingsResponse,
    accessRulesQueryOptions: vi.fn(() => ({
      queryKey: ['rbac-access-config', 'datasets', 'access-rules'],
      queryFn: vi.fn().mockResolvedValue(accessRulesResponse),
    })),
    accessRulesKey: vi.fn(() => ['rbac-access-config', 'datasets', 'access-rules']),
    userAccessSettingsQueryOptions: vi.fn(() => ({
      queryKey: ['rbac-access-config', 'datasets', 'user-access-settings'],
      queryFn: vi.fn().mockResolvedValue(userAccessSettingsResponse),
    })),
    userAccessSettingsKey: vi.fn(() => ['rbac-access-config', 'datasets', 'user-access-settings']),
    userAccessSettingsQueryKey: vi.fn(() => ['rbac-access-config', 'datasets', 'user-access-settings', 'dataset-1']),
    updateOpenScope: vi.fn().mockResolvedValue({}),
    updateUserAccessSettings: vi.fn().mockResolvedValue({}),
    removeMemberBindings: vi.fn().mockResolvedValue({}),
  }
})

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
    it('should fetch and normalize access rules for a dataset id', async () => {
      const { result } = renderHook(() => useDatasetAccessRules('dataset-1', 'ja'), { wrapper: createWrapper() })

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
      await waitFor(() => {
        expect(result.current.data).toEqual({
          dataset_id: 'dataset-1',
          items: [
            {
              policy: {
                id: 'policy-1',
                tenant_id: '',
                resource_type: 'dataset',
                policy_key: '',
                name: 'Dataset policy',
                description: '',
                permission_keys: ['dataset:read'],
                is_builtin: true,
                category: 'global_system_default',
                created_at: '0',
                updated_at: '0',
              },
              roles: [
                {
                  role_id: 'role-1',
                  role_name: 'Dataset operator',
                  binding_id: 'binding-role-1',
                  is_locked: false,
                  role_tag: '',
                },
              ],
              accounts: [
                {
                  account_id: 'account-1',
                  account_name: 'Alice',
                  binding_id: 'binding-account-1',
                  is_locked: true,
                  avatar: 'avatar.png',
                },
              ],
            },
          ],
        })
      })
    })
  })

  // User access settings mirror the app access-config API shape for datasets.
  describe('User Access Settings', () => {
    it('should fetch and normalize user access settings for a dataset id', async () => {
      const { result } = renderHook(() => useDatasetUserAccessSettings('dataset-1', 'zh'), { wrapper: createWrapper() })

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
      await waitFor(() => {
        expect(result.current.data).toEqual({
          data: [
            {
              account: {
                account_id: 'account-1',
                account_name: 'Alice',
                email: 'alice@example.com',
                avatar: '',
              },
              roles: [
                {
                  id: 'role-1',
                  type: 'dataset',
                  category: 'global_custom',
                  name: 'Dataset operator',
                  is_builtin: true,
                  permission_keys: [],
                },
              ],
              access_policies: [
                {
                  id: 'policy-1',
                  tenant_id: '',
                  resource_type: 'dataset',
                  policy_key: '',
                  name: 'Dataset policy',
                  description: '',
                  permission_keys: [],
                  is_builtin: false,
                  category: 'global_custom',
                  created_at: '0',
                  updated_at: '0',
                },
              ],
            },
          ],
          scope: 'all',
        })
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
