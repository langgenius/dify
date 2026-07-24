import type { Datasource } from '@/app/components/rag-pipeline/components/panel/test-run/types'
import type { DataSourceNotionPageMap, NotionPage } from '@/models/common'
import type { CrawlResultItem, DocumentItem, FileItem } from '@/models/datasets'
import type { OnlineDriveFile } from '@/models/pipeline'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DatasourceType } from '@/models/pipeline'
import { createDataSourceStore } from '../../data-source/store'
import { useDatasourceActions } from '../use-datasource-actions'

const mockRunPublishedPipeline = vi.fn()
vi.mock('@/service/use-pipeline', () => ({
  useRunPublishedPipeline: () => ({
    mutateAsync: mockRunPublishedPipeline,
    isIdle: true,
    isPending: false,
  }),
}))
vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: vi.fn(),
}))

describe('useDatasourceActions', () => {
  let store: ReturnType<typeof createDataSourceStore>
  const defaultParams = () => ({
    datasource: { nodeId: 'node-1', nodeData: { provider_type: DatasourceType.localFile } } as unknown as Datasource,
    datasourceType: DatasourceType.localFile,
    pipelineId: 'pipeline-1',
    dataSourceStore: store,
    setEstimateData: vi.fn(),
    setBatchId: vi.fn(),
    setDocuments: vi.fn(),
    handleNextStep: vi.fn(),
    PagesMapAndSelectedPagesId: {},
    currentWorkspacePages: undefined as { page_id: string }[] | undefined,
    clearOnlineDocumentData: vi.fn(),
    clearWebsiteCrawlData: vi.fn(),
    clearOnlineDriveData: vi.fn(),
    setDatasource: vi.fn(),
  })

  beforeEach(() => {
    vi.clearAllMocks()
    store = createDataSourceStore()
  })

  it('should return all action functions', () => {
    const params = defaultParams()
    const { result } = renderHook(() => useDatasourceActions(params))

    expect(typeof result.current.onClickProcess).toBe('function')
    expect(typeof result.current.onClickPreview).toBe('function')
    expect(typeof result.current.handleSubmit).toBe('function')
    expect(typeof result.current.handlePreviewFileChange).toBe('function')
    expect(typeof result.current.handlePreviewOnlineDocumentChange).toBe('function')
    expect(typeof result.current.handlePreviewWebsiteChange).toBe('function')
    expect(typeof result.current.handlePreviewOnlineDriveFileChange).toBe('function')
    expect(typeof result.current.handleSelectAll).toBe('function')
    expect(typeof result.current.handleSwitchDataSource).toBe('function')
    expect(typeof result.current.handleCredentialChange).toBe('function')
    expect(result.current.isIdle).toBe(true)
    expect(result.current.isPending).toBe(false)
  })

  it('should handle credential change by clearing data and setting new credential', () => {
    const params = defaultParams()
    const { result } = renderHook(() => useDatasourceActions(params))

    act(() => {
      result.current.handleCredentialChange('cred-new')
    })

    expect(store.getState().currentCredentialId).toBe('cred-new')
  })

  it('should handle switch data source', () => {
    const params = defaultParams()
    const newDatasource = {
      nodeId: 'node-2',
      nodeData: { provider_type: DatasourceType.onlineDocument },
    } as unknown as Datasource

    const { result } = renderHook(() => useDatasourceActions(params))
    act(() => {
      result.current.handleSwitchDataSource(newDatasource)
    })

    expect(store.getState().currentCredentialId).toBe('')
    expect(store.getState().currentNodeIdRef.current).toBe('node-2')
    expect(params.setDatasource).toHaveBeenCalledWith(newDatasource)
  })

  it('should handle preview file change by updating ref', () => {
    const params = defaultParams()
    params.dataSourceStore = store

    const { result } = renderHook(() => useDatasourceActions(params))

    // Set up formRef to prevent null error
    result.current.formRef.current = { submit: vi.fn() }

    const file = { id: 'f1', name: 'test.pdf' } as unknown as DocumentItem
    act(() => {
      result.current.handlePreviewFileChange(file)
    })

    expect(store.getState().previewLocalFileRef.current).toEqual(file)
  })

  it('should handle preview online document change', () => {
    const params = defaultParams()
    const { result } = renderHook(() => useDatasourceActions(params))
    result.current.formRef.current = { submit: vi.fn() }

    const page = { page_id: 'p1', page_name: 'My Page' } as unknown as NotionPage
    act(() => {
      result.current.handlePreviewOnlineDocumentChange(page)
    })

    expect(store.getState().previewOnlineDocumentRef.current).toEqual(page)
  })

  it('should handle preview website change', () => {
    const params = defaultParams()
    const { result } = renderHook(() => useDatasourceActions(params))
    result.current.formRef.current = { submit: vi.fn() }

    const website = { title: 'Page', source_url: 'https://example.com' } as unknown as CrawlResultItem
    act(() => {
      result.current.handlePreviewWebsiteChange(website)
    })

    expect(store.getState().previewWebsitePageRef.current).toEqual(website)
  })

  it('should handle select all for online documents', () => {
    const params = defaultParams()
    params.datasourceType = DatasourceType.onlineDocument
    params.currentWorkspacePages = [{ page_id: 'p1' }, { page_id: 'p2' }] as unknown as NotionPage[]
    params.PagesMapAndSelectedPagesId = {
      p1: { page_id: 'p1', page_name: 'A', workspace_id: 'w1' },
      p2: { page_id: 'p2', page_name: 'B', workspace_id: 'w1' },
    } as unknown as DataSourceNotionPageMap

    const { result } = renderHook(() => useDatasourceActions(params))

    // First call: select all
    act(() => {
      result.current.handleSelectAll()
    })
    expect(store.getState().onlineDocuments).toHaveLength(2)

    // Second call: deselect all
    act(() => {
      result.current.handleSelectAll()
    })
    expect(store.getState().onlineDocuments).toEqual([])
  })

  it('should handle select all for online drive', () => {
    const params = defaultParams()
    params.datasourceType = DatasourceType.onlineDrive

    store.getState().setOnlineDriveFileList([
      { id: 'f1', type: 'file' },
      { id: 'f2', type: 'file' },
      { id: 'b1', type: 'bucket' },
    ] as unknown as OnlineDriveFile[])

    const { result } = renderHook(() => useDatasourceActions(params))

    act(() => {
      result.current.handleSelectAll()
    })
    // Should select f1, f2 but not b1 (bucket)
    expect(store.getState().selectedFileIds).toEqual(['f1', 'f2'])
  })

  it('should handle submit with preview mode', async () => {
    const params = defaultParams()
    store.getState().setLocalFileList([{ file: { id: 'f1', name: 'test.pdf' } }] as unknown as FileItem[])
    store.getState().previewLocalFileRef.current = { id: 'f1', name: 'test.pdf' } as unknown as DocumentItem

    mockRunPublishedPipeline.mockResolvedValue({ data: { outputs: { tokens: 100 } } })

    const { result } = renderHook(() => useDatasourceActions(params))

    // Set preview mode
    result.current.isPreview.current = true

    await act(async () => {
      await result.current.handleSubmit({ query: 'test' })
    })

    expect(mockRunPublishedPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        pipeline_id: 'pipeline-1',
        is_preview: true,
        start_node_id: 'node-1',
      }),
      expect.anything(),
    )
  })
})
