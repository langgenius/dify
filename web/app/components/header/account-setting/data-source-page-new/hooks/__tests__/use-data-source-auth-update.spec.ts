import type { PropsWithChildren } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { consoleQuery } from '@/service/console'
import { useDataSourceAuthUpdate } from '../use-data-source-auth-update'

describe('datasource authentication reconciliation', () => {
  let client: QueryClient
  const catalogKey = consoleQuery.rag.pipelines.datasourcePlugins.get.queryKey()
  const unrelatedKey = consoleQuery.account.profile.get.key()
  const datasource = consoleQuery.auth.plugin.datasource
  const authKeys = [
    datasource.list.get.queryKey(),
    datasource.defaultList.get.queryKey(),
    datasource.byProviderId.get.queryKey({
      input: { params: { provider_id: 'langgenius/notion/notion' } },
    }),
  ]
  const otherProviderKey = datasource.byProviderId.get.queryKey({
    input: { params: { provider_id: 'langgenius/firecrawl/firecrawl' } },
  })
  const wrapper = ({ children }: PropsWithChildren) =>
    createElement(QueryClientProvider, { client }, children)
  beforeEach(() => {
    client = new QueryClient()
    client.setQueryData(catalogKey, [])
    client.setQueryData(unrelatedKey, { cached: true })
    for (const key of [...authKeys, otherProviderKey]) client.setQueryData(key, { result: [] })
  })
  afterEach(() => client.clear())

  it('invalidates catalog availability and retains authorization reconciliation', () => {
    const { result } = renderHook(
      () =>
        useDataSourceAuthUpdate({
          pluginId: 'langgenius/notion',
          provider: 'notion',
        }),
      { wrapper },
    )

    act(() => result.current.handleAuthUpdate())

    expect(client.getQueryState(catalogKey)?.isInvalidated).toBe(true)
    expect(client.getQueryState(unrelatedKey)?.isInvalidated).toBe(false)
    for (const key of authKeys) expect(client.getQueryState(key)?.isInvalidated).toBe(true)
    expect(client.getQueryState(otherProviderKey)?.isInvalidated).toBe(false)
  })
})
