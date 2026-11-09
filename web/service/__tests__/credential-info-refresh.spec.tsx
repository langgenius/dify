import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import { createElement } from 'react'
import { createDeferred } from '@/test/deferred'
import { useInvalidPluginCredentialInfo } from '../use-plugins-auth'

const providerUrl = '/workspaces/current/tool-provider/builtin/github/credential/info'
const key = (url: string) => ['plugins-auth', 'credential-info', url]

it('waits for every active provider credential list, including explicitly included IDs', async ({
  onTestFinished,
}) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  onTestFinished(() => client.clear())
  const requests = [createDeferred<string[]>(), createDeferred<string[]>()]
  const urls = [providerUrl, `${providerUrl}?include_credential_ids=previous-id`]
  urls.forEach((url, index) => {
    client.setQueryData(key(url), ['existing'])
    const load = vi.fn().mockReturnValue(requests[index]!.promise)
    const observer = new QueryObserver(client, {
      queryKey: key(url),
      queryFn: load,
      staleTime: Infinity,
    })
    onTestFinished(observer.subscribe(() => {}))
  })
  const unrelatedKey = key('/workspaces/current/tool-provider/builtin/slack/credential/info')
  client.setQueryData(unrelatedKey, ['unrelated'])
  const { result } = renderHook(() => useInvalidPluginCredentialInfo(providerUrl), {
    wrapper: ({ children }) => createElement(QueryClientProvider, { client }, children),
  })
  const completed = vi.fn()
  const refresh = result.current({ throwOnError: true }).then(completed)

  requests[0]!.resolve(['existing', 'created'])
  await requests[0]!.promise
  expect(completed).not.toHaveBeenCalled()
  requests[1]!.resolve(['existing', 'created'])
  await refresh

  urls.forEach((url) => expect(client.getQueryData(key(url))).toEqual(['existing', 'created']))
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
  client.setQueryData(key(providerUrl), ['existing'])
  const observer = new QueryObserver(client, {
    queryKey: key(providerUrl),
    queryFn: load,
    staleTime: Infinity,
  })
  onTestFinished(observer.subscribe(() => {}))
  const { result } = renderHook(() => useInvalidPluginCredentialInfo(providerUrl), {
    wrapper: ({ children }) => createElement(QueryClientProvider, { client }, children),
  })

  await expect(result.current({ throwOnError: true })).rejects.toBe(failure)
  expect(client.getQueryData(key(providerUrl))).toEqual(['existing'])
})
