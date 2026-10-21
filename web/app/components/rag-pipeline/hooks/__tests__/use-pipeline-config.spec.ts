import type { PropsWithChildren } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { WorkflowContext } from '@/app/components/workflow/context'
import { EditorResourceScope } from '@/app/components/workflow/editor-resource/provider'
import { createWorkflowStore } from '@/app/components/workflow/store'
import { consoleQuery } from '@/service/console'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import { createWorkflowResponseFixture } from '@/test/fixtures/workflow-response'
import { createDatasourceProvider } from '../../__tests__/datasource-fixtures'
import { createRagPipelineSliceSlice } from '../../store'
import { usePipelineConfig } from '../use-pipeline-config'

const mocks = vi.hoisted(() => ({
  request: vi.fn<(url: string) => Promise<Response>>(),
  catalog: vi.fn<() => Promise<Response>>(),
  defaults: vi.fn<(url: string) => Promise<Response>>(),
  published: vi.fn<(url: string) => Promise<Response>>(),
}))
vi.mock('@/service/base', () => ({ request: mocks.request }))

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
    mocks.catalog.mockImplementation(async () => Response.json([]))
    mocks.defaults.mockImplementation(async () => Response.json([]))
    mocks.published.mockImplementation(async () => Response.json(null))
    mocks.request.mockImplementation(async (url) => {
      if (url.endsWith('/datasource-plugins')) return mocks.catalog()
      if (url.endsWith('/default-workflow-block-configs')) return mocks.defaults(url)
      if (url.endsWith('/publish')) return mocks.published(url)
      if (url.endsWith('/files/upload')) return Response.json(createFileUploadConfigFixture())
      throw new Error(`Unexpected request ${url}`)
    })
  })
  afterEach(() => client.clear())

  it('hydrates the store from cached raw data before refreshing it', async () => {
    const cached = [createDatasourceProvider()]
    client.setQueryData(catalog.queryKey(), cached)
    let resolveRequest!: (response: Response) => void
    mocks.catalog.mockReturnValue(
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
    expect(mocks.catalog).toHaveBeenCalledOnce()
    expect(mocks.request).toHaveBeenCalledWith(
      expect.stringContaining('/rag/pipelines/datasource-plugins'),
      expect.anything(),
      expect.anything(),
    )
    expect(client.getQueryData(catalog.queryKey())).toEqual(refreshed)
    expect(store.getState().dataSourceList).toBe(client.getQueryData(catalog.queryKey()))
    expect(cached[0]?.declaration.identity.icon).toBe('/datasource.svg')
  })

  it('reconciles an empty catalog on background invalidation', async () => {
    const providers = [createDatasourceProvider()]
    mocks.catalog.mockResolvedValueOnce(Response.json(providers))
    renderHook(usePipelineConfig, { wrapper })
    await waitFor(() => expect(store.getState().dataSourceList).toEqual(providers))

    await act(async () => client.invalidateQueries({ queryKey: catalog.key() }))

    await waitFor(() => expect(store.getState().dataSourceList).toEqual([]))
    expect(mocks.catalog).toHaveBeenCalledTimes(2)
  })

  it('does not request or hydrate datasource state before a pipeline is available', () => {
    pipelineId = ''
    client.setQueryData(catalog.queryKey(), [createDatasourceProvider()])
    renderHook(usePipelineConfig, { wrapper })

    expect(mocks.catalog).not.toHaveBeenCalled()
    expect(store.getState().dataSourceList).toEqual([])
    expect(mocks.defaults).not.toHaveBeenCalled()
    expect(mocks.published).not.toHaveBeenCalled()
  })

  it('fetches and synchronizes when the pipeline becomes available', async () => {
    pipelineId = ''
    const providers = [createDatasourceProvider()]
    mocks.catalog.mockResolvedValue(Response.json(providers))
    const { rerender } = renderHook(usePipelineConfig, { wrapper })

    pipelineId = 'pipeline-2'
    rerender()

    await waitFor(() => expect(store.getState().dataSourceList).toEqual(providers))
  })

  it('keeps cached data when refreshing fails without retrying the availability request', async () => {
    const providers = [createDatasourceProvider()]
    client.setQueryData(catalog.queryKey(), providers)
    mocks.catalog.mockRejectedValue(new Error('Datasource catalog unavailable'))
    renderHook(usePipelineConfig, { wrapper })

    await waitFor(() => expect(client.getQueryState(catalog.queryKey())?.status).toBe('error'))
    expect(client.getQueryState(catalog.queryKey())?.fetchFailureCount).toBe(1)
    expect(mocks.catalog).toHaveBeenCalledOnce()
    expect(store.getState().dataSourceList).toEqual(providers)
  })

  it('hydrates all configuration from the generated cache before refreshing', async () => {
    const workflows = consoleQuery.rag.pipelines.byPipelineId.workflows
    const input = { params: { pipeline_id: pipelineId } }
    const defaultsKey = workflows.defaultWorkflowBlockConfigs.get.queryKey({ input })
    const publishKey = workflows.publish.get.queryKey({ input })
    const uploadKey = consoleQuery.files.upload.get.queryKey()
    const config = [{ type: 'llm', config: { model: 'cached' } }]
    const upload = createFileUploadConfigFixture({ file_size_limit: 23 })
    client.setQueryData(defaultsKey, config)
    client.setQueryData(publishKey, createWorkflowResponseFixture({ created_at: 123 }))
    client.setQueryData(uploadKey, upload)
    // Keep refreshes pending so only cached data can hydrate the new editor.
    mocks.request.mockImplementation(() => new Promise(() => {}))

    const { unmount } = renderHook(usePipelineConfig, { wrapper })

    expect(store.getState().nodesDefaultConfigs).toEqual({ llm: { model: 'cached' } })
    expect(store.getState().publishedAt).toBe(123_000)
    expect(store.getState().fileUploadConfig).toEqual(upload)
    unmount()
    store = createWorkflowStore({ injectWorkflowStoreSliceFn: createRagPipelineSliceSlice })
    renderHook(usePipelineConfig, { wrapper })
    expect(store.getState().nodesDefaultConfigs).toEqual({ llm: { model: 'cached' } })
    expect(store.getState().publishedAt).toBe(123_000)
    expect(store.getState().fileUploadConfig).toEqual(upload)
  })

  it('refreshes node defaults and clears the published timestamp for an unpublished pipeline', async () => {
    mocks.defaults.mockResolvedValueOnce(
      Response.json([{ type: 'llm', config: { model: 'first' } }]),
    )
    mocks.published.mockResolvedValueOnce(
      Response.json(createWorkflowResponseFixture({ created_at: 123 })),
    )
    renderHook(usePipelineConfig, { wrapper })
    await waitFor(() => expect(store.getState().publishedAt).toBe(123_000))
    expect(store.getState().nodesDefaultConfigs).toEqual({ llm: { model: 'first' } })

    await act(async () =>
      client.invalidateQueries({
        queryKey: consoleQuery.rag.pipelines.byPipelineId.workflows.key(),
      }),
    )

    await waitFor(() => expect(store.getState().publishedAt).toBe(0))
    expect(store.getState().nodesDefaultConfigs).toEqual({})
  })

  it('does not apply a previous pipeline response after switching editors', async () => {
    let resolvePrevious!: (response: Response) => void
    mocks.defaults.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePrevious = resolve
        }),
    )
    mocks.defaults.mockResolvedValueOnce(
      Response.json([{ type: 'llm', config: { model: 'second' } }]),
    )
    const { rerender } = renderHook(usePipelineConfig, { wrapper })
    await waitFor(() => expect(mocks.defaults).toHaveBeenCalledOnce())

    pipelineId = 'pipeline-2'
    rerender()
    await waitFor(() =>
      expect(store.getState().nodesDefaultConfigs).toEqual({ llm: { model: 'second' } }),
    )
    await act(async () =>
      resolvePrevious(Response.json([{ type: 'llm', config: { model: 'first' } }])),
    )

    expect(store.getState().nodesDefaultConfigs).toEqual({ llm: { model: 'second' } })
    expect(mocks.defaults).toHaveBeenLastCalledWith(
      expect.stringContaining('/pipelines/pipeline-2/'),
    )
  })
})
