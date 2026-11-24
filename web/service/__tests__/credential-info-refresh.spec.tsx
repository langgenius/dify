import type { consoleClient } from '@/service/console'
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import { createElement } from 'react'
import { useInvalidPluginCredentialInfoHook } from '@/app/components/plugins/plugin-auth/hooks/use-credential'
import { AuthCategory } from '@/app/components/plugins/plugin-auth/types'
import { consoleQuery } from '@/service/console'
import { createDeferred } from '@/test/deferred'

const credentialInfo =
  consoleQuery.workspaces.current.toolProvider.builtin.byProvider.credential.info.get
type CredentialInfo = Awaited<
  ReturnType<
    typeof consoleClient.workspaces.current.toolProvider.builtin.byProvider.credential.info.get
  >
>
const provider = 'github'
const credentialInfoResponse = (
  credentialIds: string[],
  credentialProvider = provider,
): CredentialInfo => ({
  credentials: credentialIds.map((id) => ({
    id,
    name: id,
    provider: credentialProvider,
    credential_type: 'api-key',
    created_by: '',
    from_other_member: false,
    is_default: false,
    visibility: 'private',
  })),
  is_oauth_custom_client_enabled: false,
  supported_credential_types: ['api-key'],
})
const initialInfo = credentialInfoResponse(['existing'])
const refreshedInfo = credentialInfoResponse(['existing', 'created'])
const pluginPayload = { category: AuthCategory.tool, provider }
const providerKey = credentialInfo.queryKey({ input: { params: { provider } } })
const includedKey = credentialInfo.queryKey({
  input: { params: { provider }, query: { include_credential_ids: ['previous-id'] } },
})

it('waits for every active provider credential list, including explicitly included IDs', async ({
  onTestFinished,
}) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  onTestFinished(() => client.clear())
  const requests = [createDeferred<CredentialInfo>(), createDeferred<CredentialInfo>()]
  const keys = [providerKey, includedKey]
  keys.forEach((queryKey, index) => {
    client.setQueryData(queryKey, initialInfo)
    const load = vi.fn().mockReturnValue(requests[index]!.promise)
    const observer = new QueryObserver(client, {
      queryKey,
      queryFn: load,
      staleTime: Infinity,
    })
    onTestFinished(observer.subscribe(() => {}))
  })
  const unrelatedKey = credentialInfo.queryKey({ input: { params: { provider: 'slack' } } })
  client.setQueryData(unrelatedKey, credentialInfoResponse(['unrelated'], 'slack'))
  const { result } = renderHook(() => useInvalidPluginCredentialInfoHook(pluginPayload), {
    wrapper: ({ children }) => createElement(QueryClientProvider, { client }, children),
  })
  const completed = vi.fn()
  const refresh = Promise.resolve(result.current({ throwOnError: true })).then(completed)

  requests[0]!.resolve(refreshedInfo)
  await requests[0]!.promise
  expect(completed).not.toHaveBeenCalled()
  requests[1]!.resolve(refreshedInfo)
  await refresh

  keys.forEach((queryKey) => expect(client.getQueryData(queryKey)).toEqual(refreshedInfo))
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
  client.setQueryData(providerKey, initialInfo)
  const observer = new QueryObserver(client, {
    queryKey: providerKey,
    queryFn: load,
    staleTime: Infinity,
  })
  onTestFinished(observer.subscribe(() => {}))
  const { result } = renderHook(() => useInvalidPluginCredentialInfoHook(pluginPayload), {
    wrapper: ({ children }) => createElement(QueryClientProvider, { client }, children),
  })

  await expect(result.current({ throwOnError: true })).rejects.toBe(failure)
  expect(client.getQueryData(providerKey)).toEqual(initialInfo)
})
