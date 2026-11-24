import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import { createElement } from 'react'
import { useInvalidPluginCredentialInfoHook } from '@/app/components/plugins/plugin-auth/hooks/use-credential'
import { AuthCategory } from '@/app/components/plugins/plugin-auth/types'
import { consoleQuery } from '@/service/console'
import { createDeferred } from '@/test/deferred'

const providerPayload = { category: AuthCategory.tool, provider: 'github' }
const credentialInfo = (names: string[]) => ({
  credentials: names.map((name, index) => ({
    id: `cred-${index}`,
    name,
    provider: 'github',
    credential_type: 'api-key' as const,
    is_default: index === 0,
    created_by: 'user-1',
    from_other_member: false,
    visibility: 'workspace',
  })),
  supported_credential_types: ['api-key' as const],
  is_oauth_custom_client_enabled: false,
})
type CredentialInfoData = ReturnType<typeof credentialInfo>
const key = (provider: string, includeCredentialIds?: string[]) =>
  consoleQuery.workspaces.current.toolProvider.builtin.byProvider.credential.info.get.queryKey({
    input: {
      params: { provider },
      ...(includeCredentialIds?.length
        ? { query: { include_credential_ids: includeCredentialIds } }
        : {}),
    },
  })

it('waits for every active provider credential list, including explicitly included IDs', async ({
  onTestFinished,
}) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  onTestFinished(() => client.clear())
  const requests = [createDeferred<CredentialInfoData>(), createDeferred<CredentialInfoData>()]
  const queryKeys = [key('github'), key('github', ['previous-id'])]
  queryKeys.forEach((queryKey, index) => {
    client.setQueryData(queryKey, credentialInfo(['existing']))
    const load = vi.fn().mockReturnValue(requests[index]!.promise)
    const observer = new QueryObserver(client, {
      queryKey,
      queryFn: load,
      staleTime: Infinity,
    })
    onTestFinished(observer.subscribe(() => {}))
  })
  const unrelatedKey = key('slack')
  client.setQueryData(unrelatedKey, credentialInfo(['unrelated']))
  const { result } = renderHook(() => useInvalidPluginCredentialInfoHook(providerPayload), {
    wrapper: ({ children }) => createElement(QueryClientProvider, { client }, children),
  })
  const completed = vi.fn()
  const refresh = Promise.resolve(result.current({ throwOnError: true })).then(completed)

  const updated = credentialInfo(['existing', 'created'])
  requests[0]!.resolve(updated)
  await requests[0]!.promise
  expect(completed).not.toHaveBeenCalled()
  requests[1]!.resolve(updated)
  await refresh

  queryKeys.forEach((queryKey) => expect(client.getQueryData(queryKey)).toEqual(updated))
  expect(client.getQueryState(unrelatedKey)?.isInvalidated).toBe(false)
  expect(completed).toHaveBeenCalledOnce()
})

it('lets the creation owner handle a failed refresh without replacing cached credentials', async ({
  onTestFinished,
}) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  onTestFinished(() => client.clear())
  const failure = new Error('Unable to load connections')
  const load = vi.fn().mockRejectedValue(failure)
  const providerKey = key('github')
  const initial = credentialInfo(['existing'])
  client.setQueryData(providerKey, initial)
  const observer = new QueryObserver(client, {
    queryKey: providerKey,
    queryFn: load,
    staleTime: Infinity,
  })
  onTestFinished(observer.subscribe(() => {}))
  const { result } = renderHook(() => useInvalidPluginCredentialInfoHook(providerPayload), {
    wrapper: ({ children }) => createElement(QueryClientProvider, { client }, children),
  })

  await expect(result.current({ throwOnError: true })).rejects.toBe(failure)
  expect(client.getQueryData(providerKey)).toEqual(initial)
})
