import type { AppAccessMatrix, ResourceUserAccessPoliciesResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import {
  useAppAccessRules,
  useAppUserAccessSettings,
  useRemoveAppAccessPolicyMemberBindings,
  useUpdateAppOpenScope,
  useUpdateAppUserAccessSettings,
} from '../use-app-access-config'

const mocks = vi.hoisted(() => {
  const accessRulesResponse = {
    app_id: 'app-1',
    items: [
      {
        policy: {
          id: 'policy-1',
          resource_type: 'app',
          name: 'Custom policy',
          created_at: 100,
          updated_at: 200,
        },
        roles: [
          {
            role_id: 'role-1',
            role_name: 'Owner',
            binding_id: 'binding-role-1',
            role_tag: 'owner',
          },
        ],
        accounts: [
          {
            account_id: 'account-1',
            account_name: 'Alice',
            binding_id: 'binding-account-1',
          },
        ],
      },
      {
        policy: null,
      },
    ],
  } satisfies AppAccessMatrix
  const userAccessSettingsResponse = {
    data: [
      {
        account: {
          account_id: 'account-1',
        },
        roles: [
          {
            id: 'role-1',
            type: 'workspace',
            category: 'global_system_default',
            name: 'Owner',
            permission_keys: ['app:read'],
            role_tag: 'owner',
          },
        ],
        access_policies: [
          {
            id: 'policy-1',
            resource_type: 'app',
            name: 'Custom policy',
            category: 'global_custom',
            permission_keys: ['app:read'],
          },
        ],
      },
    ],
    scope: 'only_me',
  } satisfies ResourceUserAccessPoliciesResponse

  return {
    accessRulesResponse,
    userAccessSettingsResponse,
    accessRulesQueryOptions: vi.fn(() => ({
      queryKey: ['rbac-access-config', 'apps', 'access-rules'],
      queryFn: vi.fn().mockResolvedValue(accessRulesResponse),
    })),
    accessRulesKey: vi.fn(() => ['rbac-access-config', 'apps', 'access-rules']),
    userAccessSettingsQueryOptions: vi.fn(() => ({
      queryKey: ['rbac-access-config', 'apps', 'user-access-settings'],
      queryFn: vi.fn().mockResolvedValue(userAccessSettingsResponse),
    })),
    userAccessSettingsKey: vi.fn(() => ['rbac-access-config', 'apps', 'user-access-settings']),
    userAccessSettingsQueryKey: vi.fn(() => ['rbac-access-config', 'apps', 'user-access-settings', 'app-1']),
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
          apps: {
            byAppId: {
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
          apps: {
            byAppId: {
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

describe('use-app-access-config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Queries load app-specific access policies from the RBAC app route.
  describe('Queries', () => {
    it('should fetch and normalize access rules for an app id', async () => {
      const { result } = renderHook(() => useAppAccessRules('app-1', 'zh'), { wrapper: createWrapper() })

      expect(mocks.accessRulesQueryOptions).toHaveBeenCalledWith({
        input: {
          params: {
            app_id: 'app-1',
          },
          query: {
            language: 'zh',
          },
        },
      })
      await waitFor(() => {
        expect(result.current.data).toEqual({
          app_id: 'app-1',
          items: [
            {
              policy: {
                id: 'policy-1',
                tenant_id: '',
                resource_type: 'app',
                policy_key: '',
                name: 'Custom policy',
                description: '',
                permission_keys: [],
                is_builtin: false,
                category: 'global_custom',
                created_at: '100',
                updated_at: '200',
              },
              roles: [
                {
                  role_id: 'role-1',
                  role_name: 'Owner',
                  binding_id: 'binding-role-1',
                  is_locked: false,
                  role_tag: 'owner',
                },
              ],
              accounts: [
                {
                  account_id: 'account-1',
                  account_name: 'Alice',
                  binding_id: 'binding-account-1',
                  is_locked: false,
                  avatar: '',
                },
              ],
            },
          ],
        })
      })
    })
  })

  // User access settings configure which access policies apply to app users.
  describe('User Access Settings', () => {
    it('should fetch and normalize user access settings for an app id', async () => {
      const { result } = renderHook(() => useAppUserAccessSettings('app-1', 'en'), { wrapper: createWrapper() })

      expect(mocks.userAccessSettingsQueryOptions).toHaveBeenCalledWith({
        input: {
          params: {
            app_id: 'app-1',
          },
          query: {
            language: 'en',
          },
        },
      })
      await waitFor(() => {
        expect(result.current.data).toEqual({
          data: [
            {
              account: {
                account_id: 'account-1',
                account_name: '',
                email: '',
                avatar: '',
              },
              roles: [
                {
                  id: 'role-1',
                  type: 'workspace',
                  category: 'global_system_default',
                  name: 'Owner',
                  is_builtin: false,
                  permission_keys: ['app:read'],
                },
              ],
              access_policies: [
                {
                  id: 'policy-1',
                  tenant_id: '',
                  resource_type: 'app',
                  policy_key: '',
                  name: 'Custom policy',
                  description: '',
                  permission_keys: ['app:read'],
                  is_builtin: false,
                  category: 'global_custom',
                  created_at: '0',
                  updated_at: '0',
                },
              ],
            },
          ],
          scope: 'specific',
        })
      })
    })

    it('should update user access settings for an app id', async () => {
      const { result } = renderHook(() => useUpdateAppUserAccessSettings('app-1'), { wrapper: createWrapper() })

      await act(async () => {
        await result.current.mutateAsync({ accountId: 'account-1', accessPolicyIds: ['policy-1', 'policy-2'] })
      })

      expect(mocks.updateUserAccessSettings).toHaveBeenCalledWith({
        params: {
          app_id: 'app-1',
          target_account_id: 'account-1',
        },
        body: {
          access_policy_ids: ['policy-1', 'policy-2'],
        },
      })
      expect(mocks.userAccessSettingsKey).toHaveBeenCalled()
      expect(mocks.accessRulesKey).toHaveBeenCalled()
    })

    it('should remove app access policy member bindings for account ids', async () => {
      const { result } = renderHook(() => useRemoveAppAccessPolicyMemberBindings('app-1'), { wrapper: createWrapper() })

      await act(async () => {
        await result.current.mutateAsync({ accessPolicyId: 'policy-1', accountIds: ['account-1'] })
      })

      expect(mocks.removeMemberBindings).toHaveBeenCalledWith({
        params: {
          app_id: 'app-1',
          policy_id: 'policy-1',
        },
        body: {
          account_ids: ['account-1'],
        },
      })
      expect(mocks.userAccessSettingsKey).toHaveBeenCalled()
      expect(mocks.accessRulesKey).toHaveBeenCalled()
    })

    it('should update open scope for an app id', async () => {
      const { result } = renderHook(() => useUpdateAppOpenScope('app-1'), { wrapper: createWrapper() })

      await act(async () => {
        await result.current.mutateAsync('all')
      })

      expect(mocks.updateOpenScope).toHaveBeenCalledWith({
        params: {
          app_id: 'app-1',
        },
        body: {
          scope: 'all',
        },
      })
      expect(mocks.userAccessSettingsKey).toHaveBeenCalled()
    })
  })
})
