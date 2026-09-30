import type { PropsWithChildren } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { consoleQuery } from '@/service/console'
import { commonQueryKeys } from '@/service/use-common'
import { PluginCategoryEnum } from '../../../types'
import useRefreshPluginList from '../use-refresh-plugin-list'

const mocks = vi.hoisted(() => ({
  request: vi.fn<(url: string) => Promise<Response>>(),
  installed: vi.fn(),
  checkInstalled: vi.fn(),
  defaultModel: vi.fn(),
  toolProviders: vi.fn(),
  builtInTools: vi.fn(),
  dataSourceAuth: vi.fn(),
  triggers: vi.fn(),
  recommended: vi.fn(),
}))

vi.mock('@/service/base', () => ({ request: mocks.request }))
vi.mock('@/service/use-plugins', () => ({
  useInvalidateCheckInstalled: () => mocks.checkInstalled,
  useInvalidateInstalledPluginList: () => mocks.installed,
}))
vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useInvalidateDefaultModel: () => mocks.defaultModel,
}))
vi.mock('@/service/use-tools', () => ({
  useInvalidateAllToolProviders: () => mocks.toolProviders,
  useInvalidateAllBuiltInTools: () => mocks.builtInTools,
  useInvalidateRAGRecommendedPlugins: () => mocks.recommended,
}))
vi.mock('@/service/use-datasource', () => ({
  useInvalidDataSourceListAuth: () => mocks.dataSourceAuth,
}))
vi.mock('@/service/use-triggers', () => ({
  useInvalidateAllTriggerPlugins: () => mocks.triggers,
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
  commonQueryKeys.modelProviderDetails,
]
const datasourceKey = consoleQuery.rag.pipelines.datasourcePlugins.get.queryKey()
const unrelatedKey = consoleQuery.account.profile.get.key()
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
    for (const key of [...strategyKeys, ...providerKeys, unrelatedKey])
      client.setQueryData(key, { cached: true })
    client.setQueryData(datasourceKey, [])
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

    expect(mocks.installed).toHaveBeenCalledWith(PluginCategoryEnum.agent)
    expect(mocks.checkInstalled).toHaveBeenCalledOnce()
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
      if (category === PluginCategoryEnum.tool) {
        expect(mocks.toolProviders).toHaveBeenCalledOnce()
        expect(mocks.builtInTools).toHaveBeenCalledOnce()
        expect(mocks.recommended).toHaveBeenCalledWith('tool')
      }
      if (category === PluginCategoryEnum.datasource) {
        expect(client.getQueryState(datasourceKey)?.isInvalidated).toBe(true)
        expect(mocks.dataSourceAuth).toHaveBeenCalledOnce()
      }
      if (category === PluginCategoryEnum.trigger) expect(mocks.triggers).toHaveBeenCalledOnce()
    },
  )

  it.each([false, true])('refreshes model data and defaults; all categories = %s', async (all) => {
    const { result } = renderHook(useRefreshPluginList, { wrapper })

    act(() => result.current.refreshPluginList({ category: PluginCategoryEnum.model }, all))

    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(modelTypes.length))
    for (const modelType of modelTypes) {
      expect(
        mocks.request.mock.calls.some(([url]) => url.endsWith(`/model-types/${modelType}`)),
      ).toBe(true)
      expect(mocks.defaultModel).toHaveBeenCalledWith(modelType)
    }
    for (const key of providerKeys) expect(client.getQueryState(key)?.isInvalidated).toBe(true)
    for (const key of strategyKeys) expect(client.getQueryState(key)?.isInvalidated).toBe(all)
    expect(client.getQueryState(unrelatedKey)?.isInvalidated).toBe(false)
    expect(client.getQueryState(datasourceKey)?.isInvalidated).toBe(all)
    if (all) {
      expect(mocks.installed).toHaveBeenCalledWith()
      expect(mocks.toolProviders).toHaveBeenCalledOnce()
      expect(mocks.builtInTools).toHaveBeenCalledOnce()
      expect(client.getQueryState(datasourceKey)?.isInvalidated).toBe(true)
      expect(mocks.dataSourceAuth).toHaveBeenCalledOnce()
      expect(mocks.triggers).toHaveBeenCalledOnce()
      expect(mocks.recommended).toHaveBeenCalledWith('tool')
    }
  })

  it.each([null, undefined])(
    'only refreshes installation caches without a manifest (%s)',
    (manifest) => {
      const { result } = renderHook(useRefreshPluginList, { wrapper })

      act(() => result.current.refreshPluginList(manifest))

      expect(mocks.installed).toHaveBeenCalledWith()
      expect(mocks.checkInstalled).toHaveBeenCalledOnce()
      for (const key of [...strategyKeys, ...providerKeys])
        expect(client.getQueryState(key)?.isInvalidated).toBe(false)
      expect(mocks.toolProviders).not.toHaveBeenCalled()
      expect(client.getQueryState(datasourceKey)?.isInvalidated).toBe(false)
      expect(mocks.triggers).not.toHaveBeenCalled()
      expect(mocks.request).not.toHaveBeenCalled()
    },
  )
})
