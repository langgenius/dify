import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import {
  useAppResourceWhitelist,
  useAppResourceWhitelistConfig,
  useAppUserAccessSettings,
  useRemoveAppAccessPolicyMemberBindings,
  useUpdateAppAutomaticIncludeWorkspaceMembers,
} from '../use-app-access-config'
import {
  useDatasetResourceWhitelistConfig,
  useDatasetUserAccessSettings,
  useRemoveDatasetAccessPolicyMemberBindings,
  useUpdateDatasetAutomaticIncludeWorkspaceMembers,
} from '../use-dataset-access-config'

const mocks = vi.hoisted(() => ({
  appPut: vi.fn(),
  datasetPut: vi.fn(),
  appDeleteMemberBindings: vi.fn(),
  datasetDeleteMemberBindings: vi.fn(),
  appUserGet: vi.fn(),
  datasetUserGet: vi.fn(),
  appWhitelistGet: vi.fn(),
  appWhitelistConfigGet: vi.fn(),
  datasetWhitelistConfigGet: vi.fn(),
  appUserQueryOptions: vi.fn(),
  datasetUserQueryOptions: vi.fn(),
  appWhitelistQueryOptions: vi.fn(),
  appWhitelistConfigQueryOptions: vi.fn(),
  datasetWhitelistConfigQueryOptions: vi.fn(),
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
                  memberBindings: { delete: mocks.appDeleteMemberBindings },
                },
              },
              whitelist: { put: mocks.appPut },
            },
          },
          datasets: {
            byDatasetId: {
              accessPolicies: {
                byPolicyId: {
                  memberBindings: { delete: mocks.datasetDeleteMemberBindings },
                },
              },
              whitelist: { put: mocks.datasetPut },
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
              accessPolicy: { get: { key: () => ['app-access-policy'] } },
              userAccessPolicies: {
                get: {
                  key: () => ['app-user-access-policies'],
                  queryOptions: mocks.appUserQueryOptions,
                },
              },
              whitelist: {
                get: {
                  key: () => ['app-whitelist'],
                  queryOptions: mocks.appWhitelistQueryOptions,
                },
              },
              whitelistConfig: {
                get: {
                  key: () => ['app-whitelist-config'],
                  queryOptions: mocks.appWhitelistConfigQueryOptions,
                },
              },
            },
          },
          datasets: {
            byDatasetId: {
              accessPolicy: { get: { key: () => ['dataset-access-policy'] } },
              userAccessPolicies: {
                get: {
                  key: () => ['dataset-user-access-policies'],
                  queryOptions: mocks.datasetUserQueryOptions,
                },
              },
              whitelist: {
                get: { key: () => ['dataset-whitelist'] },
              },
              whitelistConfig: {
                get: {
                  key: () => ['dataset-whitelist-config'],
                  queryOptions: mocks.datasetWhitelistConfigQueryOptions,
                },
              },
            },
          },
        },
      },
    },
  },
}))

const createHarness = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )

  return { queryClient, wrapper }
}

describe('resource access config queries and mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.appUserGet.mockResolvedValue({
      data: [],
      pagination: {
        current_page: 3,
        per_page: 20,
        total_count: 45,
        total_pages: 3,
      },
    })
    mocks.appWhitelistGet.mockResolvedValue({
      account_ids: ['account-1'],
    })
    mocks.datasetUserGet.mockResolvedValue({
      data: [],
      pagination: {
        current_page: 2,
        per_page: 20,
        total_count: 25,
        total_pages: 2,
      },
    })
    mocks.appUserQueryOptions.mockImplementation(({ input }) => ({
      queryKey: ['app-user-access-policies', input],
      queryFn: mocks.appUserGet,
    }))
    mocks.appWhitelistQueryOptions.mockImplementation(({ input }) => ({
      queryKey: ['app-whitelist', input],
      queryFn: mocks.appWhitelistGet,
    }))
    mocks.appWhitelistConfigGet.mockResolvedValue({
      automatic_include_workspace_members: true,
    })
    mocks.appWhitelistConfigQueryOptions.mockImplementation(({ input }) => ({
      queryKey: ['app-whitelist-config', input],
      queryFn: mocks.appWhitelistConfigGet,
    }))
    mocks.datasetUserQueryOptions.mockImplementation(({ input }) => ({
      queryKey: ['dataset-user-access-policies', input],
      queryFn: mocks.datasetUserGet,
    }))
    mocks.datasetWhitelistConfigGet.mockResolvedValue({
      automatic_include_workspace_members: false,
    })
    mocks.datasetWhitelistConfigQueryOptions.mockImplementation(({ input }) => ({
      queryKey: ['dataset-whitelist-config', input],
      queryFn: mocks.datasetWhitelistConfigGet,
    }))
    mocks.appPut.mockResolvedValue({
      account_ids: [],
    })
    mocks.datasetPut.mockResolvedValue({
      account_ids: [],
    })
    mocks.appDeleteMemberBindings.mockResolvedValue({ account_ids: [] })
    mocks.datasetDeleteMemberBindings.mockResolvedValue({ account_ids: [] })
  })

  it('should request one stable page of app member policies', async () => {
    const { wrapper } = createHarness()
    const { result } = renderHook(() => useAppUserAccessSettings('app-1', 'en', 3, 50), {
      wrapper,
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(mocks.appUserQueryOptions).toHaveBeenCalledWith({
      input: {
        params: { app_id: 'app-1' },
        query: { language: 'en', limit: 50, page: 3, reverse: false },
      },
    })
    expect(result.current.data?.pagination.current_page).toBe(3)
  })

  it('should read full account ids from the app whitelist', async () => {
    const { wrapper } = createHarness()
    const { result } = renderHook(() => useAppResourceWhitelist('app-1'), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(mocks.appWhitelistQueryOptions).toHaveBeenCalledWith({
      input: { params: { app_id: 'app-1' } },
    })
    expect(result.current.data).toEqual({
      account_ids: ['account-1'],
    })
  })

  it('should read app automatic inclusion from the whitelist config', async () => {
    const { wrapper } = createHarness()
    const { result } = renderHook(() => useAppResourceWhitelistConfig('app-1'), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(mocks.appWhitelistConfigQueryOptions).toHaveBeenCalledWith({
      input: { params: { app_id: 'app-1' } },
    })
    expect(result.current.data).toEqual({
      automatic_include_workspace_members: true,
    })
  })

  it('should request one stable page of dataset member policies', async () => {
    const { wrapper } = createHarness()
    const { result } = renderHook(() => useDatasetUserAccessSettings('dataset-1', 'en', 2, 25), {
      wrapper,
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(mocks.datasetUserQueryOptions).toHaveBeenCalledWith({
      input: {
        params: { dataset_id: 'dataset-1' },
        query: { language: 'en', limit: 25, page: 2, reverse: false },
      },
    })
  })

  it('should read dataset automatic inclusion from the whitelist config', async () => {
    const { wrapper } = createHarness()
    const { result } = renderHook(
      () => useDatasetResourceWhitelistConfig('dataset-1', { enabled: true }),
      { wrapper },
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(mocks.datasetWhitelistConfigQueryOptions).toHaveBeenCalledWith({
      input: { params: { dataset_id: 'dataset-1' } },
    })
    expect(result.current.data).toEqual({
      automatic_include_workspace_members: false,
    })
  })

  it('should update automatic inclusion and invalidate the app member list and whitelist data', async () => {
    const { queryClient, wrapper } = createHarness()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue()
    const { result } = renderHook(() => useUpdateAppAutomaticIncludeWorkspaceMembers('app-1'), {
      wrapper,
    })

    await act(async () => result.current.mutateAsync(true))

    expect(mocks.appPut).toHaveBeenCalledWith({
      params: { app_id: 'app-1' },
      body: { automatic_include_workspace_members: true },
    })
    expect(invalidateQueries).toHaveBeenCalledTimes(3)
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['app-user-access-policies'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['app-whitelist'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['app-whitelist-config'] })
  })

  it('should update automatic inclusion and invalidate the dataset member list and whitelist data', async () => {
    const { queryClient, wrapper } = createHarness()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue()
    const { result } = renderHook(
      () => useUpdateDatasetAutomaticIncludeWorkspaceMembers('dataset-1'),
      { wrapper },
    )

    await act(async () => result.current.mutateAsync(false))

    expect(mocks.datasetPut).toHaveBeenCalledWith({
      params: { dataset_id: 'dataset-1' },
      body: { automatic_include_workspace_members: false },
    })
    expect(invalidateQueries).toHaveBeenCalledTimes(3)
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['dataset-user-access-policies'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['dataset-whitelist'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['dataset-whitelist-config'] })
  })

  it('should remove app member bindings in one mutation and invalidate queries once', async () => {
    const { queryClient, wrapper } = createHarness()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue()
    const { result } = renderHook(() => useRemoveAppAccessPolicyMemberBindings('app-1'), {
      wrapper,
    })

    await act(async () =>
      result.current.mutateAsync([
        { accessPolicyId: 'policy-1', accountIds: ['account-1', 'account-2'] },
        { accessPolicyId: 'default', accountIds: ['account-3'] },
      ]),
    )

    expect(mocks.appDeleteMemberBindings).toHaveBeenCalledTimes(2)
    expect(mocks.appDeleteMemberBindings).toHaveBeenNthCalledWith(1, {
      params: { app_id: 'app-1', policy_id: 'policy-1' },
      body: { account_ids: ['account-1', 'account-2'] },
    })
    expect(mocks.appDeleteMemberBindings).toHaveBeenNthCalledWith(2, {
      params: { app_id: 'app-1', policy_id: 'default' },
      body: { account_ids: ['account-3'] },
    })
    expect(invalidateQueries).toHaveBeenCalledTimes(3)
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['app-user-access-policies'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['app-access-policy'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['app-whitelist'] })
  })

  it('should remove dataset member bindings in one mutation and invalidate queries once', async () => {
    const { queryClient, wrapper } = createHarness()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue()
    const { result } = renderHook(() => useRemoveDatasetAccessPolicyMemberBindings('dataset-1'), {
      wrapper,
    })

    await act(async () =>
      result.current.mutateAsync([
        { accessPolicyId: 'policy-1', accountIds: ['account-1', 'account-2'] },
        { accessPolicyId: 'default', accountIds: ['account-3'] },
      ]),
    )

    expect(mocks.datasetDeleteMemberBindings).toHaveBeenCalledTimes(2)
    expect(mocks.datasetDeleteMemberBindings).toHaveBeenNthCalledWith(1, {
      params: { dataset_id: 'dataset-1', policy_id: 'policy-1' },
      body: { account_ids: ['account-1', 'account-2'] },
    })
    expect(mocks.datasetDeleteMemberBindings).toHaveBeenNthCalledWith(2, {
      params: { dataset_id: 'dataset-1', policy_id: 'default' },
      body: { account_ids: ['account-3'] },
    })
    expect(invalidateQueries).toHaveBeenCalledTimes(3)
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['dataset-user-access-policies'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['dataset-access-policy'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['dataset-whitelist'] })
  })
})
