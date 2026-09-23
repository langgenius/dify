import type { PropsWithChildren } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { WorkflowContext } from '@/app/components/workflow/context'
import { createWorkflowStore } from '@/app/components/workflow/store'
import { consoleQuery } from '@/service/console'
import { createDatasourceProvider } from '../../__tests__/datasource-fixtures'
import { createRagPipelineSliceSlice } from '../../store'
import { usePipelineConfig } from '../use-pipeline-config'

const mocks = vi.hoisted(() => ({
  request: vi.fn<(url: string) => Promise<Response>>(),
  workflowConfig: vi.fn<(url: string, callback: (data: unknown) => void) => void>(),
}))
vi.mock('@/service/base', () => ({ request: mocks.request }))
vi.mock('@/service/use-workflow', () => ({ useWorkflowConfig: mocks.workflowConfig }))

const catalog = consoleQuery.rag.pipelines.datasourcePlugins.get

describe('usePipelineConfig', () => {
  let client: QueryClient
  let store: ReturnType<typeof createWorkflowStore>
  const wrapper = ({ children }: PropsWithChildren) =>
    createElement(
      QueryClientProvider,
      { client },
      createElement(WorkflowContext.Provider, { value: store }, children),
    )

  beforeEach(() => {
    vi.clearAllMocks()
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
    store = createWorkflowStore({ injectWorkflowStoreSliceFn: createRagPipelineSliceSlice })
    store.setState({ pipelineId: 'pipeline-1' })
    mocks.request.mockResolvedValue(Response.json([]))
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
    store.setState({ pipelineId: '' })
    client.setQueryData(catalog.queryKey(), [createDatasourceProvider()])
    renderHook(usePipelineConfig, { wrapper })

    expect(mocks.request).not.toHaveBeenCalled()
    expect(store.getState().dataSourceList).toEqual([])
    expect(mocks.workflowConfig).toHaveBeenCalledWith('', expect.any(Function))
  })

  it('fetches and synchronizes when the pipeline becomes available', async () => {
    store.setState({ pipelineId: '' })
    const providers = [createDatasourceProvider()]
    mocks.request.mockResolvedValue(Response.json(providers))
    renderHook(usePipelineConfig, { wrapper })

    act(() => store.setState({ pipelineId: 'pipeline-2' }))

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

  it('retains the other pipeline configuration entrypoints', () => {
    renderHook(usePipelineConfig, { wrapper })
    expect(mocks.workflowConfig).toHaveBeenCalledWith(
      '/rag/pipelines/pipeline-1/workflows/default-workflow-block-configs',
      expect.any(Function),
    )
    expect(mocks.workflowConfig).toHaveBeenCalledWith(
      '/rag/pipelines/pipeline-1/workflows/publish',
      expect.any(Function),
    )
    expect(mocks.workflowConfig).toHaveBeenCalledWith('/files/upload', expect.any(Function))
  })

  it.each([[{ type: 'llm', config: { model: 'test' } }], { llm: { model: 'test' } }])(
    'retains default node configuration normalization',
    (config) => {
      renderHook(usePipelineConfig, { wrapper })
      const callback = mocks.workflowConfig.mock.calls.find(([url]) =>
        url.endsWith('default-workflow-block-configs'),
      )?.[1]
      act(() => callback?.(config))
      expect(store.getState().nodesDefaultConfigs).toEqual({ llm: { model: 'test' } })
    },
  )

  it.each([{ created_at: 123 }, null])(
    'retains the publication timestamp fallback',
    (published) => {
      renderHook(usePipelineConfig, { wrapper })
      const callback = mocks.workflowConfig.mock.calls.find(([url]) =>
        url.endsWith('/publish'),
      )?.[1]
      act(() => callback?.(published))
      expect(store.getState().publishedAt).toBe((published?.created_at ?? 0) * 1000)
    },
  )
})
