import type { WorkflowAppBlockingResponse } from '@dify/contracts/api/console/rag/types.gen'
import type { Datasource } from '@/app/components/rag-pipeline/components/panel/test-run/types'
import type { NotionPage } from '@/models/common'
import { act, waitFor } from '@testing-library/react'
import { BlockEnum } from '@/app/components/workflow/types'
import { DatasourceType } from '@/models/pipeline'
import { renderHookWithConsoleQuery as renderHook } from '@/test/console/query-data'
import { createDataSourceStore } from '../../data-source/store'
import { useDatasourceActions } from '../use-datasource-actions'

const { runPipeline } = vi.hoisted(() => ({ runPipeline: vi.fn() }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'rag.pipelines.byPipelineId.workflows.published.run.post': runPipeline,
    }),
  }
})
vi.mock('@/app/components/base/amplitude', () => ({ trackEvent: vi.fn() }))

const datasource = (provider_type: DatasourceType, nodeId = 'node-1'): Datasource => ({
  nodeId,
  nodeData: {
    type: BlockEnum.DataSource,
    title: 'Documents',
    desc: '',
    provider_type,
    plugin_id: 'datasource',
    provider_name: 'source',
    datasource_name: 'documents',
    datasource_label: 'Documents',
    datasource_parameters: {},
    datasource_configurations: {},
  },
})
const page = (page_id: string): NotionPage => ({
  page_id,
  page_name: page_id,
  workspace_id: 'w1',
  page_icon: null,
  parent_id: '',
  type: 'page',
  is_bound: false,
})
const previewResponse: WorkflowAppBlockingResponse = {
  task_id: 'task-1',
  workflow_run_id: 'run-1',
  data: {
    id: 'run-1',
    workflow_id: 'workflow-1',
    status: 'succeeded',
    created_at: 1700000000,
    finished_at: 1700000001,
    elapsed_time: 1,
    total_steps: 1,
    total_tokens: 100,
    outputs: { total_segments: 1, preview: [] },
  },
}

function setup(type: DatasourceType = DatasourceType.localFile, canProcess = true) {
  const store = createDataSourceStore()
  const params = {
    datasource: datasource(type),
    datasourceType: type,
    pipelineId: 'pipeline-1',
    dataSourceStore: store,
    canProcess,
    setEstimateData: vi.fn(),
    setBatchId: vi.fn(),
    setDocuments: vi.fn(),
    handleNextStep: vi.fn(),
    PagesMapAndSelectedPagesId: { p1: page('p1'), p2: page('p2') },
    currentWorkspacePages: [{ page_id: 'p1' }, { page_id: 'p2' }],
    clearOnlineDocumentData: vi.fn(),
    clearWebsiteCrawlData: vi.fn(),
    clearOnlineDriveData: vi.fn(),
    setDatasource: vi.fn(),
  }
  const hook = renderHook(() => useDatasourceActions(params))
  return { ...hook, params, store }
}

beforeEach(() => runPipeline.mockResolvedValue(previewResponse))

it('clears source data when credentials change and resets credentials when switching sources', () => {
  const { result, params, store } = setup(DatasourceType.onlineDocument)
  store.getState().setCurrentCredentialId('old')
  act(() => result.current.handleCredentialChange('new'))
  expect(store.getState().currentCredentialId).toBe('new')
  expect(params.clearOnlineDocumentData).toHaveBeenCalledOnce()

  const next = datasource(DatasourceType.onlineDrive, 'node-2')
  act(() => result.current.handleSwitchDataSource(next))
  expect(store.getState().currentCredentialId).toBe('')
  expect(params.clearOnlineDriveData).toHaveBeenCalledOnce()
  expect(params.setDatasource).toHaveBeenCalledWith(next)
})

it('selects all current workspace pages and clears their selection together', () => {
  const { result, store, params } = setup(DatasourceType.onlineDocument)
  act(() => result.current.handleSelectAll(true))
  expect(store.getState().onlineDocuments).toEqual(Object.values(params.PagesMapAndSelectedPagesId))
  expect(store.getState().selectedPagesId).toEqual(new Set(['p1', 'p2']))
  act(() => result.current.handleSelectAll(false))
  expect(store.getState().onlineDocuments).toEqual([])
  expect(store.getState().selectedPagesId).toEqual(new Set())
})

it('excludes buckets from the drive select-all action', () => {
  const { result, store } = setup(DatasourceType.onlineDrive)
  store.getState().setOnlineDriveFileList([
    { id: 'f1', name: 'a.pdf', type: 'file' },
    { id: 'f2', name: 'b.pdf', type: 'file' },
    { id: 'b1', name: 'Bucket', type: 'bucket' },
  ])
  act(() => result.current.handleSelectAll(true))
  expect(store.getState().selectedFileIds).toEqual(['f1', 'f2'])
  act(() => result.current.handleSelectAll(false))
  expect(store.getState().selectedFileIds).toEqual([])
})

it('previews only the selected drive file with its credential and forwards the estimate', async () => {
  const { result, store, params } = setup(DatasourceType.onlineDrive)
  store.getState().setCurrentCredentialId('cred-1')
  store.getState().setBucket('documents')
  result.current.formRef.current = { submit: () => result.current.handleSubmit({ query: 'test' }) }
  act(() =>
    result.current.handlePreviewOnlineDriveFileChange({ id: 'f1', name: 'a.pdf', type: 'file' }),
  )
  await waitFor(() =>
    expect(runPipeline).toHaveBeenCalledWith({
      params: { pipeline_id: 'pipeline-1' },
      body: {
        inputs: { query: 'test' },
        start_node_id: 'node-1',
        datasource_type: DatasourceType.onlineDrive,
        datasource_info_list: [
          { bucket: 'documents', id: 'f1', name: 'a.pdf', type: 'file', credential_id: 'cred-1' },
        ],
        is_preview: true,
        response_mode: 'blocking',
      },
    }),
  )
  await waitFor(() =>
    expect(params.setEstimateData).toHaveBeenCalledWith({ total_segments: 1, preview: [] }),
  )
  expect(params.handleNextStep).not.toHaveBeenCalled()
})

it('blocks both the process trigger and form submission without permission', () => {
  const { result, params } = setup(DatasourceType.localFile, false)
  const submit = vi.fn()
  result.current.formRef.current = { submit }
  act(() => result.current.onClickProcess())
  expect(submit).not.toHaveBeenCalled()
  act(() => result.current.handleSubmit({ query: 'test' }))
  expect(runPipeline).not.toHaveBeenCalled()
  expect(params.handleNextStep).not.toHaveBeenCalled()
})
