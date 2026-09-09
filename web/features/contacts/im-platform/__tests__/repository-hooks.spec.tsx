import type { ImSyncRun } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ReactNode } from 'react'
import type { ContactImPlatformRepository } from '../repository'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { consoleQuery } from '@/service/client'
import { ContactsImPlatformProvider } from '../composition'
import {
  CONTACT_IM_SYNC_POLL_INTERVAL_MS,
  useContactImActiveSync,
  useContactImIntegrations,
  useContactImProviderDefinitions,
  useContactImSyncItems,
  useContactImSyncRun,
  useSaveContactImCredentials,
  useStartContactImSync,
} from '../hooks'
import { createContactImMockRepository } from '../mock/repository'
import { ContactImMockScenario } from '../mock/scenarios'
import { contactImPlatformQueryKeys } from '../query-keys'
import { createContactImSyncApi } from '../repository'
import { ContactImProvider, ContactImSyncStatus } from '../types'

const organization = {
  canManage: true,
  organizationId: 'org-hooks',
  workspaceId: 'workspace-hooks',
}

const createHarness = (
  repository: ContactImPlatformRepository,
  queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  }),
) => ({
  queryClient,
  wrapper: ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ContactsImPlatformProvider organization={organization} repository={repository}>
        {children}
      </ContactsImPlatformProvider>
    </QueryClientProvider>
  ),
})

describe('Contact IM repository hooks', () => {
  it('reads through the injected repository without making a network request', async () => {
    const repository = createContactImMockRepository({
      organization,
      scenario: ContactImMockScenario.Connected,
    })
    const getIntegrations = vi.spyOn(repository, 'getIntegrations')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { queryClient, wrapper } = createHarness(repository)
    const { result } = renderHook(() => useContactImIntegrations(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(getIntegrations).toHaveBeenCalledWith(organization.organizationId)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(
      queryClient.getQueryData([
        ...contactImPlatformQueryKeys.integrations(
          organization.organizationId,
          repository.queryKey,
        ),
        repository,
      ]),
    ).toEqual([expect.objectContaining({ provider: ContactImProvider.Slack })])

    fetchSpy.mockRestore()
    queryClient.clear()
  })

  it('refreshes channel state and dependent contact choices after saving', async () => {
    const repository = createContactImMockRepository({
      organization,
      scenario: ContactImMockScenario.NotConfigured,
    })
    const { queryClient, wrapper } = createHarness(repository)
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useSaveContactImCredentials(), { wrapper })
    const secret = 'discard-after-save'

    await act(async () => {
      await result.current.saveCredentials({
        provider: ContactImProvider.Slack,
        replaceActiveProvider: false,
        retainSecret: false,
        secret,
        values: { appId: 'app-hooks' },
      })
    })

    for (const queryKey of [
      ['contacts-management', organization.workspaceId],
      consoleQuery.workspace.current.humanInput.v2.channels.key(),
      consoleQuery.workspaces.current.humanInput.contactOptions.key(),
      consoleQuery.workspaces.current.humanInput.imIdentities.key(),
    ])
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: contactImPlatformQueryKeys.integrations(
        organization.organizationId,
        repository.queryKey,
      ),
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: contactImPlatformQueryKeys.activeSync(
        organization.organizationId,
        repository.queryKey,
      ),
    })
    expect(JSON.stringify(queryClient.getMutationCache().getAll())).not.toContain(secret)
    queryClient.clear()
  })

  it('does not retain or log a secret after a rejected mutation', async () => {
    const repository = createContactImMockRepository({
      organization,
      scenario: ContactImMockScenario.SaveFailure,
    })
    const { queryClient, wrapper } = createHarness(repository)
    const { result } = renderHook(() => useSaveContactImCredentials(), { wrapper })
    const secret = 'never-log-or-cache-this-secret'
    const consoleSpies = [
      vi.spyOn(console, 'error').mockImplementation(() => undefined),
      vi.spyOn(console, 'log').mockImplementation(() => undefined),
      vi.spyOn(console, 'warn').mockImplementation(() => undefined),
    ]
    let caughtError: unknown

    await act(async () => {
      caughtError = await result.current
        .saveCredentials({
          provider: ContactImProvider.Slack,
          replaceActiveProvider: false,
          retainSecret: false,
          secret,
          values: { appId: 'safe-app-id' },
        })
        .catch((error: unknown) => error)
    })

    expect(JSON.stringify(caughtError)).not.toContain(secret)
    expect(JSON.stringify(queryClient.getMutationCache().getAll())).not.toContain(secret)
    expect(JSON.stringify(consoleSpies.flatMap((spy) => spy.mock.calls))).not.toContain(secret)

    for (const spy of consoleSpies) spy.mockRestore()
    queryClient.clear()
  })

  it('polls an active run under timer control and stops at its terminal state', async () => {
    vi.useFakeTimers()
    const repository = createContactImMockRepository({
      organization,
      scenario: ContactImMockScenario.ActiveSync,
    })
    const getSyncRun = vi.spyOn(repository, 'getSyncRun')
    const { queryClient, wrapper } = createHarness(repository)
    const { result, unmount } = renderHook(() => useContactImSyncRun('mock-active-sync'), {
      wrapper,
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.data?.status).toBe(ContactImSyncStatus.Queued)

    await repository.advanceSync('mock-active-sync')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CONTACT_IM_SYNC_POLL_INTERVAL_MS + 1)
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.data?.status).toBe(ContactImSyncStatus.Running)

    await repository.advanceSync('mock-active-sync')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CONTACT_IM_SYNC_POLL_INTERVAL_MS + 1)
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.data?.status).toBe(ContactImSyncStatus.PartialSuccess)
    const terminalCallCount = getSyncRun.mock.calls.length

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CONTACT_IM_SYNC_POLL_INTERVAL_MS * 3)
    })
    expect(getSyncRun).toHaveBeenCalledTimes(terminalCallCount)

    unmount()
    queryClient.clear()
    vi.useRealTimers()
  })

  it.each([
    [ContactImMockScenario.SyncSuccess, 'mock-sync-success', ContactImSyncStatus.Success],
    [
      ContactImMockScenario.SyncPartialSuccess,
      'mock-sync-partial',
      ContactImSyncStatus.PartialSuccess,
    ],
    [ContactImMockScenario.SyncFailure, 'mock-sync-failure', ContactImSyncStatus.Failure],
  ])('does not poll the %s terminal scenario', async (scenario, runId, status) => {
    vi.useFakeTimers()
    const repository = createContactImMockRepository({ organization, scenario })
    const getSyncRun = vi.spyOn(repository, 'getSyncRun')
    const { queryClient, wrapper } = createHarness(repository)
    const { result, unmount } = renderHook(() => useContactImSyncRun(runId), { wrapper })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.data?.status).toBe(status)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CONTACT_IM_SYNC_POLL_INTERVAL_MS * 3)
    })
    expect(getSyncRun).toHaveBeenCalledTimes(1)

    unmount()
    queryClient.clear()
    vi.useRealTimers()
  })
})

type SyncClient = NonNullable<Parameters<typeof createContactImSyncApi>[1]>
const createApiRun = (status: ImSyncRun['status'] = 'queued'): ImSyncRun => ({
  id: 'server-run',
  status,
  provider: 'slack',
  channel_id: 'server-channel',
  integration_config_version: 1,
  started_at: status === 'queued' ? null : 1_700_000_000,
  finished_at: status === 'succeeded' ? 1_700_000_030 : null,
  result_counts: { added: 2, failed: 0, not_matched: 0, removed: 1, skipped: 0 },
})
const createSyncClient = (run = createApiRun()) => ({
  imSyncRuns: {
    post: vi.fn<SyncClient['imSyncRuns']['post']>().mockResolvedValue({ run }),
    latest: {
      get: vi.fn<SyncClient['imSyncRuns']['latest']['get']>().mockResolvedValue({ run }),
      results: {
        get: vi
          .fn<SyncClient['imSyncRuns']['latest']['results']['get']>()
          .mockResolvedValue({ data: [], page: 1, limit: 20, total: 0 }),
      },
    },
  },
})

describe('Contact IM server synchronization', () => {
  it('posts to the generated sync endpoint and preserves a queued run with no invented start time', async () => {
    const client = createSyncClient()
    const repository = createContactImSyncApi(organization.workspaceId, client)
    await expect(
      repository.startSync({ organizationId: organization.organizationId }),
    ).resolves.toMatchObject({
      id: 'server-run',
      status: ContactImSyncStatus.Queued,
      startedAt: null,
      startedBy: null,
      durationMs: null,
    })
    expect(client.imSyncRuns.post).toHaveBeenCalledWith(undefined, { context: { silent: true } })
  })

  it('treats a missing latest run as empty but preserves network and server failures for retry', async () => {
    const client = createSyncClient()
    const repository = createContactImSyncApi(organization.workspaceId, client)
    client.imSyncRuns.latest.get.mockRejectedValueOnce(new Response(null, { status: 404 }))
    await expect(repository.getActiveSync(organization.organizationId)).resolves.toBeNull()
    client.imSyncRuns.latest.get.mockRejectedValueOnce(new Response(null, { status: 500 }))
    await expect(repository.getActiveSync(organization.organizationId)).rejects.toMatchObject({
      status: 500,
    })
    await expect(repository.getActiveSync(organization.organizationId)).resolves.toMatchObject({
      id: 'server-run',
    })
  })

  it('does not request results for an old run when the server latest run has changed', async () => {
    const client = createSyncClient(createApiRun('succeeded'))
    const repository = createContactImSyncApi(organization.workspaceId, client)
    await expect(repository.getSyncItems({ runId: 'an-old-run' })).rejects.toMatchObject({
      code: 'sync_run_not_found',
    })
    expect(client.imSyncRuns.latest.results.get).not.toHaveBeenCalled()
  })

  it('rejects results if the latest run changes while the result page is loading', async () => {
    const client = createSyncClient(createApiRun('succeeded'))
    client.imSyncRuns.latest.get
      .mockResolvedValueOnce({ run: createApiRun('succeeded') })
      .mockResolvedValue({ run: { ...createApiRun(), id: 'new-server-run' } })
    const repository = createContactImSyncApi(organization.workspaceId, client)

    await expect(repository.getSyncItems({ runId: 'server-run' })).rejects.toMatchObject({
      code: 'sync_run_not_found',
    })
    expect(client.imSyncRuns.latest.results.get).toHaveBeenCalledTimes(1)
  })

  it('polls through a recoverable request failure until the server finishes, then refreshes Contacts and stops', async () => {
    vi.useFakeTimers()
    const client = createSyncClient()
    const repository = Object.assign(
      createContactImMockRepository({ organization }),
      createContactImSyncApi(organization.workspaceId, client),
    )
    const { queryClient, wrapper } = createHarness(repository)
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const { result, unmount } = renderHook(
      () => {
        const { data, isError } = useContactImActiveSync()
        return { data, isError }
      },
      { wrapper },
    )
    const advancePoll = async () => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(CONTACT_IM_SYNC_POLL_INTERVAL_MS + 1)
        await vi.advanceTimersByTimeAsync(0)
      })
    }
    try {
      await advancePoll()
      expect(result.current.data?.status).toBe(ContactImSyncStatus.Queued)
      expect(client.imSyncRuns.latest.get.mock.calls.length).toBeGreaterThan(1)
      client.imSyncRuns.latest.get.mockResolvedValue({ run: createApiRun('running') })
      await advancePoll()
      expect(result.current.data?.status).toBe(ContactImSyncStatus.Running)
      client.imSyncRuns.latest.get.mockRejectedValue(new TypeError('Network unavailable'))
      await advancePoll()
      expect(result.current.isError).toBe(true)
      expect(result.current.data?.status).toBe(ContactImSyncStatus.Running)
      client.imSyncRuns.latest.get.mockResolvedValue({ run: createApiRun('succeeded') })
      await advancePoll()
      expect(result.current.data?.status).toBe(ContactImSyncStatus.Success)
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['contacts-management', organization.workspaceId],
      })
      const terminalCalls = client.imSyncRuns.latest.get.mock.calls.length
      await advancePoll()
      expect(client.imSyncRuns.latest.get).toHaveBeenCalledTimes(terminalCalls)
    } finally {
      unmount()
      queryClient.clear()
      vi.useRealTimers()
    }
  })

  it('does not reuse another workspace latest-run cache even with the same repository key and organization', async () => {
    const client = createSyncClient(createApiRun('succeeded'))
    const repository = Object.assign(
      createContactImMockRepository({ organization }),
      createContactImSyncApi(organization.workspaceId, client),
    )
    const { queryClient, wrapper } = createHarness(repository)
    const first = renderHook(() => useContactImActiveSync(), { wrapper })
    await waitFor(() => expect(first.result.current.data?.id).toBe('server-run'))
    first.unmount()

    let resolveLatest: ((value: { run: ImSyncRun }) => void) | undefined
    client.imSyncRuns.latest.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLatest = resolve
        }),
    )
    const nextOrganization = { ...organization, workspaceId: 'workspace-other' }
    const nextWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <ContactsImPlatformProvider organization={nextOrganization} repository={repository}>
          {children}
        </ContactsImPlatformProvider>
      </QueryClientProvider>
    )
    const second = renderHook(() => useContactImActiveSync(), { wrapper: nextWrapper })
    expect(second.result.current.data).toBeUndefined()
    await act(async () =>
      resolveLatest?.({ run: { ...createApiRun('succeeded'), id: 'workspace-other-run' } }),
    )
    await waitFor(() => expect(second.result.current.data?.id).toBe('workspace-other-run'))
    second.unmount()
    queryClient.clear()
  })
})

describe('Contacts channel request admission', () => {
  it.each([
    {
      canManage: false,
      workspaceId: organization.workspaceId,
      organizationId: organization.organizationId,
    },
    { canManage: true, workspaceId: '', organizationId: organization.organizationId },
    { canManage: true, workspaceId: organization.workspaceId, organizationId: '' },
  ])('keeps config and sync requests idle for an unavailable context: %j', async (scope) => {
    const repository = createContactImMockRepository({
      organization,
      scenario: ContactImMockScenario.Connected,
    })
    const reads = [
      vi.spyOn(repository, 'getIntegrations'),
      vi.spyOn(repository, 'getProviderDefinitions'),
      vi.spyOn(repository, 'getActiveSync'),
      vi.spyOn(repository, 'getSyncRun'),
      vi.spyOn(repository, 'getSyncItems'),
    ]
    const startSync = vi.spyOn(repository, 'startSync')
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <ContactsImPlatformProvider organization={scope} repository={repository}>
          {children}
        </ContactsImPlatformProvider>
      </QueryClientProvider>
    )
    const { result } = renderHook(
      () => ({
        integrations: useContactImIntegrations(),
        providers: useContactImProviderDefinitions(),
        active: useContactImActiveSync(),
        run: useContactImSyncRun('existing-run'),
        items: useContactImSyncItems({ runId: 'existing-run' }),
        start: useStartContactImSync(),
      }),
      { wrapper },
    )
    await act(async () => {
      await expect(result.current.start.mutateAsync()).rejects.toMatchObject({
        code: 'no_permission',
      })
    })
    for (const query of [
      result.current.integrations,
      result.current.providers,
      result.current.active,
      result.current.run,
      result.current.items,
    ])
      expect(query.fetchStatus).toBe('idle')
    for (const read of reads) expect(read).not.toHaveBeenCalled()
    expect(startSync).not.toHaveBeenCalled()
    queryClient.clear()
  })
})
