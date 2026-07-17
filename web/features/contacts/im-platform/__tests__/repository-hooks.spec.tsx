import type { ReactNode } from 'react'
import type { ContactImPlatformRepository } from '../repository'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { ContactsImPlatformProvider } from '../composition'
import {
  CONTACT_IM_SYNC_POLL_INTERVAL_MS,
  useContactImIntegration,
  useContactImSyncRun,
  useSaveContactImCredentials,
} from '../hooks'
import { createContactImMockRepository } from '../mock/repository'
import { ContactImMockScenario } from '../mock/scenarios'
import { contactImPlatformQueryKeys } from '../query-keys'
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
    const getIntegration = vi.spyOn(repository, 'getIntegration')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { queryClient, wrapper } = createHarness(repository)
    const { result } = renderHook(() => useContactImIntegration(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(getIntegration).toHaveBeenCalledWith(organization.organizationId)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(
      queryClient.getQueryData([
        ...contactImPlatformQueryKeys.integration(organization.organizationId, repository.queryKey),
        repository,
      ]),
    ).toMatchObject({ provider: ContactImProvider.Slack })

    fetchSpy.mockRestore()
    queryClient.clear()
  })

  it('invalidates only the integration and active-sync queries after saving', async () => {
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

    expect(invalidateQueries).toHaveBeenCalledTimes(2)
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: contactImPlatformQueryKeys.integration(
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
