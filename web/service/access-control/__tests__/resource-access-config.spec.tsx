import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { consoleQuery } from '@/service/console'
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
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.rbac.apps.byAppId.userAccessPolicies.get': mocks.appUserGet,
      'workspaces.current.rbac.datasets.byDatasetId.userAccessPolicies.get': mocks.datasetUserGet,
      'workspaces.current.rbac.apps.byAppId.whitelist.get': mocks.appWhitelistGet,
      'workspaces.current.rbac.apps.byAppId.whitelistConfig.get': mocks.appWhitelistConfigGet,
      'workspaces.current.rbac.datasets.byDatasetId.whitelistConfig.get':
        mocks.datasetWhitelistConfigGet,
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.rbac.apps.byAppId.whitelist.put': mocks.appPut,
      'workspaces.current.rbac.datasets.byDatasetId.whitelist.put': mocks.datasetPut,
      'workspaces.current.rbac.apps.byAppId.accessPolicies.byPolicyId.memberBindings.delete':
        mocks.appDeleteMemberBindings,
      'workspaces.current.rbac.datasets.byDatasetId.accessPolicies.byPolicyId.memberBindings.delete':
        mocks.datasetDeleteMemberBindings,
    }),
  }
})

function seedAccessQueries(client: QueryClient) {
  const app = consoleQuery.workspaces.current.rbac.apps.byAppId
  const dataset = consoleQuery.workspaces.current.rbac.datasets.byDatasetId
  const appInput = { input: { params: { app_id: 'app-1' } } }
  const datasetInput = { input: { params: { dataset_id: 'dataset-1' } } }
  const query = { language: 'en' as const, page: 1, limit: 20, reverse: false }
  const keys = {
    'app-access-policy': app.accessPolicy.get.queryKey({
      input: { ...appInput.input, query: { language: 'en' } },
    }),
    'app-user-access-policies': app.userAccessPolicies.get.queryKey({
      input: { ...appInput.input, query },
    }),
    'app-whitelist': app.whitelist.get.queryKey(appInput),
    'app-whitelist-config': app.whitelistConfig.get.queryKey(appInput),
    'dataset-access-policy': dataset.accessPolicy.get.queryKey({
      input: { ...datasetInput.input, query: { language: 'en' } },
    }),
    'dataset-user-access-policies': dataset.userAccessPolicies.get.queryKey({
      input: { ...datasetInput.input, query },
    }),
    'dataset-whitelist': dataset.whitelist.get.queryKey(datasetInput),
    'dataset-whitelist-config': dataset.whitelistConfig.get.queryKey(datasetInput),
  }
  for (const key of Object.values(keys)) client.setQueryData(key, {})
  return keys
}

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
    mocks.appWhitelistConfigGet.mockResolvedValue({
      automatic_include_workspace_members: true,
    })
    mocks.datasetWhitelistConfigGet.mockResolvedValue({
      automatic_include_workspace_members: false,
    })
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

    expect(mocks.appUserGet).toHaveBeenCalledWith({
      params: { app_id: 'app-1' },
      query: { language: 'en', limit: 50, page: 3, reverse: false },
    })
    expect(result.current.data?.pagination.current_page).toBe(3)
  })

  it('should read full account ids from the app whitelist', async () => {
    const { wrapper } = createHarness()
    const { result } = renderHook(() => useAppResourceWhitelist('app-1'), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(mocks.appWhitelistGet).toHaveBeenCalledWith({ params: { app_id: 'app-1' } })
    expect(result.current.data).toEqual({
      account_ids: ['account-1'],
    })
  })

  it('should read app automatic inclusion from the whitelist config', async () => {
    const { wrapper } = createHarness()
    const { result } = renderHook(() => useAppResourceWhitelistConfig('app-1'), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(mocks.appWhitelistConfigGet).toHaveBeenCalledWith({ params: { app_id: 'app-1' } })
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

    expect(mocks.datasetUserGet).toHaveBeenCalledWith({
      params: { dataset_id: 'dataset-1' },
      query: { language: 'en', limit: 25, page: 2, reverse: false },
    })
  })

  it('should read dataset automatic inclusion from the whitelist config', async () => {
    const { wrapper } = createHarness()
    const { result } = renderHook(
      () => useDatasetResourceWhitelistConfig('dataset-1', { enabled: true }),
      { wrapper },
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(mocks.datasetWhitelistConfigGet).toHaveBeenCalledWith({
      params: { dataset_id: 'dataset-1' },
    })
    expect(result.current.data).toEqual({
      automatic_include_workspace_members: false,
    })
  })

  it('should update automatic inclusion and invalidate the app member list and whitelist data', async () => {
    const { queryClient, wrapper } = createHarness()
    const keys = seedAccessQueries(queryClient)
    const { result } = renderHook(() => useUpdateAppAutomaticIncludeWorkspaceMembers('app-1'), {
      wrapper,
    })

    await act(async () => result.current.mutateAsync(true))

    expect(mocks.appPut).toHaveBeenCalledWith({
      params: { app_id: 'app-1' },
      body: { automatic_include_workspace_members: true },
    })
    expect(queryClient.getQueryState(keys['app-user-access-policies'])?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(keys['app-whitelist'])?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(keys['app-whitelist-config'])?.isInvalidated).toBe(true)
  })

  it('should update automatic inclusion and invalidate the dataset member list and whitelist data', async () => {
    const { queryClient, wrapper } = createHarness()
    const keys = seedAccessQueries(queryClient)
    const { result } = renderHook(
      () => useUpdateDatasetAutomaticIncludeWorkspaceMembers('dataset-1'),
      { wrapper },
    )

    await act(async () => result.current.mutateAsync(false))

    expect(mocks.datasetPut).toHaveBeenCalledWith({
      params: { dataset_id: 'dataset-1' },
      body: { automatic_include_workspace_members: false },
    })
    expect(queryClient.getQueryState(keys['dataset-user-access-policies'])?.isInvalidated).toBe(
      true,
    )
    expect(queryClient.getQueryState(keys['dataset-whitelist'])?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(keys['dataset-whitelist-config'])?.isInvalidated).toBe(true)
  })

  it('should remove app member bindings in one mutation and refresh cached access data', async () => {
    const { queryClient, wrapper } = createHarness()
    const keys = seedAccessQueries(queryClient)
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
    expect(queryClient.getQueryState(keys['app-user-access-policies'])?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(keys['app-access-policy'])?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(keys['app-whitelist'])?.isInvalidated).toBe(true)
  })

  it('should remove dataset member bindings in one mutation and refresh cached access data', async () => {
    const { queryClient, wrapper } = createHarness()
    const keys = seedAccessQueries(queryClient)
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
    expect(queryClient.getQueryState(keys['dataset-user-access-policies'])?.isInvalidated).toBe(
      true,
    )
    expect(queryClient.getQueryState(keys['dataset-access-policy'])?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(keys['dataset-whitelist'])?.isInvalidated).toBe(true)
  })
})
