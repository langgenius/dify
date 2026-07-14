import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import {
  useAppAccessRules,
  useAppUserAccessSettings,
  useRemoveAppAccessPolicyMemberBindings,
  useUpdateAppOpenScope,
  useUpdateAppUserAccessSettings,
} from '../use-app-access-config'

const mocks = vi.hoisted(() => ({
  accessRulesQueryOptions: vi.fn(() => ({
    queryKey: ['rbac-access-config', 'apps', 'access-rules'],
    queryFn: vi.fn().mockResolvedValue({ app_id: 'app-1', items: [] }),
  })),
  accessRulesKey: vi.fn(() => ['rbac-access-config', 'apps', 'access-rules']),
  userAccessSettingsQueryOptions: vi.fn(() => ({
    queryKey: ['rbac-access-config', 'apps', 'user-access-settings'],
    queryFn: vi.fn().mockResolvedValue({ data: [], scope: 'specific' }),
  })),
  userAccessSettingsKey: vi.fn(() => ['rbac-access-config', 'apps', 'user-access-settings']),
  userAccessSettingsQueryKey: vi.fn(() => [
    'rbac-access-config',
    'apps',
    'user-access-settings',
    'app-1',
  ]),
  updateOpenScope: vi.fn().mockResolvedValue({}),
  updateUserAccessSettings: vi.fn().mockResolvedValue({}),
  removeMemberBindings: vi.fn().mockResolvedValue({}),
}))

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
    it('should fetch access rules for an app id', () => {
      renderHook(() => useAppAccessRules('app-1', 'zh'), { wrapper: createWrapper() })

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
    })
  })

  // User access settings configure which access policies apply to app users.
  describe('User Access Settings', () => {
    it('should fetch user access settings for an app id', () => {
      renderHook(() => useAppUserAccessSettings('app-1', 'en'), { wrapper: createWrapper() })

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
    })

    it('should update user access settings for an app id', async () => {
      const { result } = renderHook(() => useUpdateAppUserAccessSettings('app-1'), {
        wrapper: createWrapper(),
      })

      await act(async () => {
        await result.current.mutateAsync({
          accountId: 'account-1',
          accessPolicyIds: ['policy-1', 'policy-2'],
        })
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
      const { result } = renderHook(() => useRemoveAppAccessPolicyMemberBindings('app-1'), {
        wrapper: createWrapper(),
      })

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
      const { result } = renderHook(() => useUpdateAppOpenScope('app-1'), {
        wrapper: createWrapper(),
      })

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
