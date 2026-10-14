import type { PropsWithChildren } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { consoleQuery } from '@/service/console'
import { useDataSourceAuthUpdate } from '../use-data-source-auth-update'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), list: vi.fn(), defaults: vi.fn() }))
vi.mock('@/service/use-datasource', () => ({
  useInvalidDataSourceAuth: () => mocks.auth,
  useInvalidDataSourceListAuth: () => mocks.list,
  useInvalidDefaultDataSourceListAuth: () => mocks.defaults,
}))

describe('datasource authentication reconciliation', () => {
  let client: QueryClient
  const catalogKey = consoleQuery.rag.pipelines.datasourcePlugins.get.queryKey()
  const unrelatedKey = consoleQuery.account.profile.get.key()
  const wrapper = ({ children }: PropsWithChildren) =>
    createElement(QueryClientProvider, { client }, children)
  beforeEach(() => {
    vi.clearAllMocks()
    client = new QueryClient()
    client.setQueryData(catalogKey, [])
    client.setQueryData(unrelatedKey, { cached: true })
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
    expect(mocks.auth).toHaveBeenCalledOnce()
    expect(mocks.list).toHaveBeenCalledOnce()
    expect(mocks.defaults).toHaveBeenCalledOnce()
  })
})
