import type { PropsWithChildren } from 'react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { consoleQuery } from '@/service/console'
import { PluginCategoryEnum } from '../../../types'
import useRefreshPluginList from '../use-refresh-plugin-list'

const mocks = vi.hoisted(() => ({
  request: vi.fn<(url: string) => Promise<Response>>(),
  installed: vi.fn(),
  defaultModel: vi.fn(),
}))

vi.mock('@/service/base', () => ({ request: mocks.request }))
vi.mock('@/service/use-plugins', () => ({
  useInvalidateInstalledPluginList: () => mocks.installed,
}))
vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useInvalidateDefaultModel: () => mocks.defaultModel,
}))

const current = consoleQuery.workspaces.current
const strategyKeys = [
  current.agentProviders.get.queryKey(),
  current.agentProvider.byProviderName.get.queryKey({
    input: { params: { provider_name: 'langgenius/agent/react' } },
  }),
  current.agentProvider.byProviderName.get.queryKey({
    input: { params: { provider_name: 'langgenius/agent/function-calling' } },
  }),
]
const providerKeys = [
  current.modelProviders.summary.get.key(),
  consoleQuery.workspaces.current.modelProviders.get.key(),
]
const pluginVersionKeys = [
  current.plugin.list.installations.ids.post.queryKey({
    input: { body: { plugin_ids: ['langgenius/test'] } },
  }),
  current.plugin.list.latestVersions.post.queryKey({
    input: { body: { plugin_ids: ['langgenius/test'] } },
  }),
]
const datasourceKey = consoleQuery.rag.pipelines.datasourcePlugins.get.queryKey()
const dataSourceAuthKey = consoleQuery.auth.plugin.datasource.list.get.queryKey()
const toolKeys = [
  current.toolProviders.get.queryKey({ input: { query: {} } }),
  current.toolProviders.get.queryKey({ input: { query: { type: 'mcp' } } }),
  current.tools.builtin.get.queryKey(),
  consoleQuery.rag.pipelines.recommendedPlugins.get.queryKey({
    input: { query: { type: 'tool' } },
  }),
]
const otherRecommendedKey = consoleQuery.rag.pipelines.recommendedPlugins.get.queryKey({
  input: { query: { type: 'datasource' } },
})
const unrelatedKey = consoleQuery.account.profile.get.key()
const triggerPluginsKey = current.triggers.get.queryKey({ input: {} })
const modelTypes = ['llm', 'text-embedding', 'rerank', 'speech2text', 'tts']

describe('plugin installation refresh', () => {
  let client: QueryClient

  const wrapper = ({ children }: PropsWithChildren) =>
    createElement(QueryClientProvider, { client }, children)

  beforeEach(() => {
    vi.clearAllMocks()
    client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    })
    for (const key of [...strategyKeys, ...providerKeys, ...pluginVersionKeys, unrelatedKey])
      client.setQueryData(key, { cached: true })
    client.setQueryData(datasourceKey, [])
    client.setQueryData(triggerPluginsKey, [])
    client.setQueryData(dataSourceAuthKey, { result: [] })
    for (const key of [...toolKeys, otherRecommendedKey]) client.setQueryData(key, [])
    for (const model_type of modelTypes) {
      client.setQueryData(
        current.models.modelTypes.byModelType.get.queryKey({ input: { params: { model_type } } }),
        { data: [] },
      )
    }
    mocks.request.mockImplementation(async () => Response.json({ data: [] }))
  })

  afterEach(() => client.clear())

  it('invalidates the strategy catalog and every provider detail after an agent plugin changes', () => {
    const { result } = renderHook(useRefreshPluginList, { wrapper })

    act(() => result.current.refreshPluginList({ category: PluginCategoryEnum.agent }))
    for (const key of pluginVersionKeys) expect(client.getQueryState(key)?.isInvalidated).toBe(true)

    expect(mocks.installed).toHaveBeenCalledWith(PluginCategoryEnum.agent)
    for (const key of strategyKeys) expect(client.getQueryState(key)?.isInvalidated).toBe(true)
    for (const key of [...providerKeys, unrelatedKey])
      expect(client.getQueryState(key)?.isInvalidated).toBe(false)
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it.each([PluginCategoryEnum.tool, PluginCategoryEnum.datasource, PluginCategoryEnum.trigger])(
    'keeps strategy caches fresh when a %s plugin changes',
    (category) => {
      const { result } = renderHook(useRefreshPluginList, { wrapper })

      act(() => result.current.refreshPluginList({ category }))

      expect(mocks.installed).toHaveBeenCalledWith(category)
      for (const key of strategyKeys) expect(client.getQueryState(key)?.isInvalidated).toBe(false)
      expect(client.getQueryState(datasourceKey)?.isInvalidated).toBe(
        category === PluginCategoryEnum.datasource,
      )
      for (const key of toolKeys)
        expect(client.getQueryState(key)?.isInvalidated).toBe(category === PluginCategoryEnum.tool)
      expect(client.getQueryState(otherRecommendedKey)?.isInvalidated).toBe(false)
      if (category === PluginCategoryEnum.datasource) {
        expect(client.getQueryState(datasourceKey)?.isInvalidated).toBe(true)
        expect(client.getQueryState(dataSourceAuthKey)?.isInvalidated).toBe(true)
      }
      expect(client.getQueryState(triggerPluginsKey)?.isInvalidated).toBe(
        category === PluginCategoryEnum.trigger,
      )
    },
  )

  it.each([false, true])('refreshes model data and defaults; all categories = %s', async (all) => {
    const { result } = renderHook(useRefreshPluginList, { wrapper })

    act(() => result.current.refreshPluginList({ category: PluginCategoryEnum.model }, all))

    for (const model_type of modelTypes) {
      expect(
        client.getQueryState(
          current.models.modelTypes.byModelType.get.queryKey({ input: { params: { model_type } } }),
        )?.isInvalidated,
      ).toBe(true)
      expect(mocks.defaultModel).toHaveBeenCalledWith(model_type)
    }
    // Unobserved model lists are marked stale and load when a model picker mounts.
    expect(mocks.request).not.toHaveBeenCalled()
    for (const key of providerKeys) expect(client.getQueryState(key)?.isInvalidated).toBe(true)
    for (const key of strategyKeys) expect(client.getQueryState(key)?.isInvalidated).toBe(all)
    expect(client.getQueryState(unrelatedKey)?.isInvalidated).toBe(false)
    expect(client.getQueryState(datasourceKey)?.isInvalidated).toBe(all)
    if (all) {
      expect(mocks.installed).toHaveBeenCalledWith()
      for (const key of toolKeys) expect(client.getQueryState(key)?.isInvalidated).toBe(true)
      expect(client.getQueryState(datasourceKey)?.isInvalidated).toBe(true)
      expect(client.getQueryState(dataSourceAuthKey)?.isInvalidated).toBe(true)
      expect(client.getQueryState(triggerPluginsKey)?.isInvalidated).toBe(true)
    }
  })

  it('does not load model lists on mount', () => {
    client.clear()
    renderHook(useRefreshPluginList, { wrapper })

    expect(mocks.request).not.toHaveBeenCalled()
    expect(client.getQueryCache().getAll()).toHaveLength(0)
  })

  it('refetches a model list that is on screen after a model plugin changes', async () => {
    const { result } = renderHook(
      () => {
        useQuery(
          current.models.modelTypes.byModelType.get.queryOptions({
            input: { params: { model_type: 'llm' } },
          }),
        )
        return useRefreshPluginList()
      },
      { wrapper },
    )

    act(() => result.current.refreshPluginList({ category: PluginCategoryEnum.model }))

    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(1))
    expect(mocks.request.mock.calls[0]![0]).toMatch(/\/model-types\/llm$/)
  })

  it('keeps the same refresh function across renders', () => {
    const { result, rerender } = renderHook(useRefreshPluginList, { wrapper })
    const first = result.current.refreshPluginList

    rerender()

    expect(result.current.refreshPluginList).toBe(first)
  })

  it('only refreshes installation caches without a manifest', () => {
    const { result } = renderHook(useRefreshPluginList, { wrapper })

    act(() => result.current.refreshPluginList())

    expect(mocks.installed).toHaveBeenCalledWith()
    for (const key of [
      ...strategyKeys,
      ...providerKeys,
      ...toolKeys,
      datasourceKey,
      dataSourceAuthKey,
    ])
      expect(client.getQueryState(key)?.isInvalidated).toBe(false)
    expect(client.getQueryState(triggerPluginsKey)?.isInvalidated).toBe(false)
    expect(mocks.request).not.toHaveBeenCalled()
  })
})
