import type { ReactNode } from 'react'
import type { ContactImPlatformRepository } from '../repository'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { ContactsImPlatformProvider } from '../composition'
import { useContactImIntegration, useSaveContactImCredentials } from '../hooks'
import { createContactImMockRepository } from '../mock/repository'
import { ContactImMockScenario } from '../mock/scenarios'
import { contactImPlatformQueryKeys } from '../query-keys'
import { ContactImProvider } from '../types'

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

    await act(async () => {
      await result.current.mutateAsync({
        provider: ContactImProvider.Slack,
        replaceActiveProvider: false,
        retainSecret: false,
        secret: 'discard-after-save',
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
    queryClient.clear()
  })
})
