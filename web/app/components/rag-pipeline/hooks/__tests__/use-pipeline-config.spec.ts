import type { PropsWithChildren } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { WorkflowContext } from '@/app/components/workflow/context'
import { EditorResourceScope } from '@/app/components/workflow/editor-resource/provider'
import { createWorkflowStore } from '@/app/components/workflow/store'
import { consoleQuery } from '@/service/console'
import { createDatasourceProvider } from '../../__tests__/datasource-fixtures'
import { createRagPipelineSliceSlice } from '../../store'
import { usePipelineConfig } from '../use-pipeline-config'

const mocks = vi.hoisted(() => ({
  request: vi.fn<(url: string) => Promise<Response>>(),
  blockConfigs: vi.fn<(url: string) => Promise<Response>>(),
  published: vi.fn<(url: string) => Promise<Response>>(),
  uploadConfig: vi.fn<(url: string) => Promise<Response>>(),
}))
vi.mock('@/service/base', () => ({
  request: (url: string) => {
    if (url.includes('/default-workflow-block-configs')) return mocks.blockConfigs(url)
    if (url.endsWith('/workflows/publish')) return mocks.published(url)
    if (url.endsWith('/files/upload')) return mocks.uploadConfig(url)
    return mocks.request(url)
  },
}))

const catalog = consoleQuery.rag.pipelines.datasourcePlugins.get

describe('usePipelineConfig', () => {
  let pipelineId: string
  let client: QueryClient
  let store: ReturnType<typeof createWorkflowStore>
  const wrapper = ({ children }: PropsWithChildren) =>
    createElement(
      QueryClientProvider,
      { client },
      createElement(EditorResourceScope, {
        resource: { kind: 'knowledge-pipeline', pipelineId },
        children: createElement(WorkflowContext.Provider, { value: store }, children),
      }),
    )

  beforeEach(() => {
    vi.clearAllMocks()
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
    store = createWorkflowStore({ injectWorkflowStoreSliceFn: createRagPipelineSliceSlice })
    pipelineId = 'pipeline-1'
    mocks.request.mockResolvedValue(Response.json([]))
    mocks.blockConfigs.mockResolvedValue(Response.json([]))
    mocks.published.mockResolvedValue(Response.json(null))
    mocks.uploadConfig.mockResolvedValue(Response.json({}))
  })
  afterEach(() => client.clear())

  it('hydrates the store from cached raw data before refreshing it', async () => {
    const cached = [createDatasourceProvider()]
    client.setQueryData(catalog.queryKey(), cached)
    let resolveRequest!: (response: Response) => void
    mocks.request.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve
      }),
    )

    renderHook(usePipelineConfig, { wrapper })

    expect(store.getState().dataSourceList).toEqual(cached)
    expect(store.getState().dataSourceList?.[0]?.declaration.identity.icon).toBe('/datasource.svg')
    const refreshed = [createDatasourceProvider({ is_authorized: false })]
    await act(async () => resolveRequest(Response.json(refreshed)))
    await waitFor(() => expect(store.getState().dataSourceList).toEqual(refreshed))
    expect(mocks.request).toHaveBeenCalledOnce()
    expect(mocks.request.mock.calls[0]?.[0]).toContain('/rag/pipelines/datasource-plugins')
    expect(client.getQueryData(catalog.queryKey())).toEqual(refreshed)
    expect(cached[0]?.declaration.identity.icon).toBe('/datasource.svg')
  })

  it('reconciles an empty catalog on background invalidation', async () => {
    const providers = [createDatasourceProvider()]
    mocks.request.mockResolvedValueOnce(Response.json(providers))
    renderHook(usePipelineConfig, { wrapper })
    await waitFor(() => expect(store.getState().dataSourceList).toEqual(providers))

    await act(async () => client.invalidateQueries({ queryKey: catalog.key() }))

    await waitFor(() => expect(store.getState().dataSourceList).toEqual([]))
    expect(mocks.request).toHaveBeenCalledTimes(2)
  })

  it('does not request or hydrate datasource state before a pipeline is available', () => {
    pipelineId = ''
    client.setQueryData(catalog.queryKey(), [createDatasourceProvider()])
    renderHook(usePipelineConfig, { wrapper })

    expect(mocks.request).not.toHaveBeenCalled()
    expect(store.getState().dataSourceList).toEqual([])
    expect(mocks.blockConfigs).not.toHaveBeenCalled()
    expect(mocks.published).not.toHaveBeenCalled()
  })

  it('fetches and synchronizes when the pipeline becomes available', async () => {
    pipelineId = ''
    const providers = [createDatasourceProvider()]
    mocks.request.mockResolvedValue(Response.json(providers))
    const { rerender } = renderHook(usePipelineConfig, { wrapper })

    pipelineId = 'pipeline-2'
    rerender()

    await waitFor(() => expect(store.getState().dataSourceList).toEqual(providers))
  })

  it('keeps cached data when refreshing fails without retrying the availability request', async () => {
    const providers = [createDatasourceProvider()]
    client.setQueryData(catalog.queryKey(), providers)
    mocks.request.mockRejectedValue(new Error('Datasource catalog unavailable'))
    renderHook(usePipelineConfig, { wrapper })

    await waitFor(() => expect(client.getQueryState(catalog.queryKey())?.status).toBe('error'))
    expect(client.getQueryState(catalog.queryKey())?.fetchFailureCount).toBe(1)
    expect(mocks.request).toHaveBeenCalledOnce()
    expect(store.getState().dataSourceList).toEqual(providers)
  })

  it('shares the raw catalog with other observers without transforming provider data', async () => {
    const providers = [createDatasourceProvider()]
    mocks.request.mockResolvedValue(Response.json(providers))
    renderHook(usePipelineConfig, { wrapper })
    await waitFor(() => expect(store.getState().dataSourceList).toEqual(providers))

    expect(store.getState().dataSourceList).toBe(client.getQueryData(catalog.queryKey()))
    expect(catalog.queryOptions()).toMatchObject({ staleTime: 0, retry: false })
  })

  it('loads default block configs, the published timestamp and the upload config', async () => {
    const uploadConfig = { file_size_limit: 15 }
    mocks.blockConfigs.mockResolvedValue(
      Response.json([{ type: 'llm', config: { model: 'test' } }]),
    )
    mocks.published.mockResolvedValue(Response.json({ created_at: 123 }))
    mocks.uploadConfig.mockResolvedValue(Response.json(uploadConfig))

    renderHook(usePipelineConfig, { wrapper })

    await waitFor(() =>
      expect(store.getState().nodesDefaultConfigs).toEqual({ llm: { model: 'test' } }),
    )
    await waitFor(() => expect(store.getState().publishedAt).toBe(123 * 1000))
    await waitFor(() => expect(store.getState().fileUploadConfig).toEqual(uploadConfig))
    expect(mocks.blockConfigs.mock.calls[0]?.[0]).toContain(
      '/rag/pipelines/pipeline-1/workflows/default-workflow-block-configs',
    )
    expect(mocks.published.mock.calls[0]?.[0]).toContain(
      '/rag/pipelines/pipeline-1/workflows/publish',
    )
  })

  it('keeps an unpublished pipeline at a zero publication timestamp', async () => {
    renderHook(usePipelineConfig, { wrapper })

    await waitFor(() => expect(mocks.published).toHaveBeenCalledOnce())
    await waitFor(() => expect(store.getState().publishedAt).toBe(0))
  })
})
