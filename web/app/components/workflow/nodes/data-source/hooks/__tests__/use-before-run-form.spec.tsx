import type { WorkflowRunNodeExecutionResponse } from '@dify/contracts/api/console/rag/types.gen'
import type { ReactNode } from 'react'
import type { CustomRunFormProps, DataSourceNodeType } from '../../types'
import type { DataSourceShape } from '@/app/components/datasets/documents/create-from-pipeline/data-source/store'
import type { Shape as HooksStore } from '@/app/components/workflow/hooks-store/store'
import { QueryClient } from '@tanstack/react-query'
import { act, waitFor } from '@testing-library/react'
import { useStoreApi } from 'reactflow'
import { createDataSourceStore } from '@/app/components/datasets/documents/create-from-pipeline/data-source/store'
import { DataSourceContext } from '@/app/components/datasets/documents/create-from-pipeline/data-source/store/provider'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowCanvasHook } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum, NodeRunningStatus } from '@/app/components/workflow/types'
import { DatasourceType } from '@/models/pipeline'
import { consoleQuery } from '@/service/console'
import { createDeferred } from '@/test/deferred'
import { TransferMethod } from '@/types/app'
import useBeforeRunForm from '../use-before-run-form'

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  inspect: vi.fn(),
  sync: vi.fn<HooksStore['doSyncWorkflowDraft']>(),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'rag.pipelines.byPipelineId.workflows.draft.datasource.variablesInspect.post': mocks.run,
    }),
  }
})
vi.mock('@/service/workflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/workflow')>()),
  fetchNodeInspectVars: mocks.inspect,
}))
const createData = (overrides: Partial<DataSourceNodeType> = {}): DataSourceNodeType => ({
  title: 'Datasource',
  desc: '',
  type: BlockEnum.DataSource,
  plugin_id: 'plugin-id',
  provider_type: DatasourceType.localFile,
  provider_name: 'provider',
  datasource_name: 'local-file',
  datasource_label: 'Local File',
  datasource_parameters: {},
  datasource_configurations: {},
  fileExtensions: ['pdf'],
  ...overrides,
})
const createProps = (overrides: Partial<CustomRunFormProps> = {}): CustomRunFormProps => ({
  nodeId: 'data-source-node',
  resource: { kind: 'knowledge-pipeline', pipelineId: 'flow-id' },
  payload: createData(),
  setRunResult: vi.fn(),
  setIsRunAfterSingleRun: vi.fn(),
  isPaused: false,
  isRunAfterSingleRun: false,
  onSuccess: vi.fn(),
  onCancel: vi.fn(),
  appendNodeInspectVars: vi.fn(),
  ...overrides,
})
const localFiles: DataSourceShape['localFileList'] = [
  {
    fileID: 'upload-1',
    progress: 100,
    file: Object.assign(new File(['pdf'], 'doc.pdf', { type: 'application/pdf' }), {
      id: 'file-1',
      extension: 'pdf',
      mime_type: 'application/pdf',
    }),
  },
]
const document: DataSourceShape['onlineDocuments'][number] = {
  workspace_id: 'workspace-1',
  page_id: 'page-1',
  page_name: 'Guide',
  page_icon: null,
  parent_id: '',
  type: 'page',
  is_bound: false,
}
const website: DataSourceShape['websitePages'][number] = {
  source_url: 'https://example.com/guide',
  title: 'Guide',
  markdown: '# Guide',
  description: 'A guide',
}
const selections = [
  {
    type: DatasourceType.localFile,
    state: { localFileList: localFiles },
    info: {
      related_id: 'file-1',
      name: 'doc.pdf',
      type: 'application/pdf',
      size: 3,
      extension: 'pdf',
      mime_type: 'application/pdf',
      url: '',
      transfer_method: TransferMethod.local_file,
    },
  },
  {
    type: DatasourceType.onlineDocument,
    state: { onlineDocuments: [document] },
    info: {
      workspace_id: 'workspace-1',
      page: {
        page_id: 'page-1',
        page_name: 'Guide',
        page_icon: null,
        parent_id: '',
        type: 'page',
        is_bound: false,
      },
      credential_id: 'credential-1',
    },
  },
  {
    type: DatasourceType.websiteCrawl,
    state: { websitePages: [website] },
    info: { ...website, credential_id: 'credential-1' },
  },
  {
    type: DatasourceType.onlineDrive,
    state: {
      selectedFileIds: ['drive-1'],
      onlineDriveFileList: [{ id: 'drive-1', name: 'Guide', type: 'file' as const }],
      bucket: 'bucket-1',
    },
    info: {
      bucket: 'bucket-1',
      id: 'drive-1',
      type: 'file',
      credential_id: 'credential-1',
    },
  },
] satisfies {
  type: DatasourceType
  state: Partial<DataSourceShape>
  info: Record<string, unknown>
}[]

function setup(props = createProps(), selection: Partial<DataSourceShape> = {}) {
  const store = createDataSourceStore()
  store.setState({ currentCredentialId: 'credential-1', ...selection })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const lastRunKey =
    consoleQuery.rag.pipelines.byPipelineId.workflows.draft.nodes.byNodeId.lastRun.get.queryKey({
      input: { params: { pipeline_id: 'flow-id', node_id: props.nodeId } },
    })
  client.setQueryData(lastRunKey, { id: 'last-run-1', status: 'succeeded' })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DataSourceContext value={store}>{children}</DataSourceContext>
  )
  let flow: ReturnType<typeof useStoreApi>
  const rendered = renderWorkflowCanvasHook(
    (props: CustomRunFormProps) => {
      flow = useStoreApi()
      return useBeforeRunForm(props)
    },
    {
      initialProps: props,
      wrapper,
      queryClient: client,
      resource: props.resource,
      nodes: [createNode({ id: props.nodeId, data: props.payload })],
      hooksStoreProps: { doSyncWorkflowDraft: mocks.sync },
    },
  )
  return {
    ...rendered,
    nodeData: () => flow.getState().getNodes()[0]!.data,
    store,
    props,
    client,
    lastRunKey,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.run.mockResolvedValue({ id: 'run-1', status: NodeRunningStatus.Succeeded })
  mocks.inspect.mockResolvedValue([])
  mocks.sync.mockImplementation(async (_skipRefresh, callbacks) => callbacks?.onSuccess?.())
})

describe('data source single run', () => {
  it.each(selections)(
    'reacts to selection changes and sends the $type payload',
    async ({ type, state, info }) => {
      const { result, store, props, nodeData } = setup(
        createProps({ payload: createData({ provider_type: type }) }),
      )
      expect(result.current.startRunBtnDisabled).toBe(true)
      act(() => store.setState(state))
      expect(result.current.startRunBtnDisabled).toBe(false)

      act(() => result.current.handleRunWithSyncDraft())

      await waitFor(() => expect(props.onSuccess).toHaveBeenCalledOnce())
      expect(mocks.run).toHaveBeenCalledExactlyOnceWith({
        params: { pipeline_id: 'flow-id' },
        body: {
          start_node_id: props.nodeId,
          start_node_title: 'Datasource',
          datasource_type: type,
          datasource_info: info,
        },
      })
      expect(mocks.inspect).toHaveBeenCalledWith(props.resource, props.nodeId)
      expect(props.appendNodeInspectVars).toHaveBeenCalledWith(
        props.nodeId,
        [],
        [expect.objectContaining({ id: props.nodeId })],
      )
      expect(props.setIsRunAfterSingleRun).toHaveBeenCalledWith(true)
      expect(nodeData()).toMatchObject({
        _singleRunningStatus: NodeRunningStatus.Succeeded,
        _isSingleRun: false,
      })
    },
  )

  it('keeps local uploads disabled until an uploaded file id exists', () => {
    const { result, store } = setup(createProps(), {
      localFileList: [{ fileID: 'pending', progress: 20, file: new File(['pdf'], 'doc.pdf') }],
    })
    expect(result.current.startRunBtnDisabled).toBe(true)
    act(() => store.getState().setLocalFileList(localFiles))
    expect(result.current.startRunBtnDisabled).toBe(false)
  })

  it('waits for draft synchronization and exposes pending state until the run settles', async () => {
    const pending = createDeferred<WorkflowRunNodeExecutionResponse>()
    mocks.run.mockReturnValue(pending.promise)
    mocks.sync.mockImplementation(async () => undefined)
    const { result, props, nodeData } = setup(createProps(), { localFileList: localFiles })
    act(() => result.current.handleRunWithSyncDraft())
    expect(mocks.run).not.toHaveBeenCalled()
    expect(nodeData()._singleRunningStatus).toBe(NodeRunningStatus.Running)
    act(() => mocks.sync.mock.calls[0]![1]?.onSuccess?.())
    await waitFor(() => expect(result.current.isPending).toBe(true))
    await act(async () => pending.resolve({ id: 'run-1', status: NodeRunningStatus.Succeeded }))
    await waitFor(() => expect(props.onSuccess).toHaveBeenCalledOnce())
    expect(result.current.isPending).toBe(false)
  })

  it('marks a rejected request failed, invalidates last run and refreshes default error outputs', async () => {
    mocks.run.mockRejectedValue(new Error('Run failed'))
    const { result, props, client, lastRunKey, nodeData } = setup(createProps(), {
      localFileList: localFiles,
    })
    act(() => result.current.handleRunWithSyncDraft())
    await waitFor(() => expect(props.appendNodeInspectVars).toHaveBeenCalledOnce())
    expect(client.getQueryState(lastRunKey)?.isInvalidated).toBe(true)
    expect(nodeData()).toMatchObject({
      _singleRunningStatus: NodeRunningStatus.Failed,
      _isSingleRun: false,
    })
    expect(props.onSuccess).not.toHaveBeenCalled()
  })

  it.each(['succeeded', 'failed'] as const)(
    'ignores a %s completion after the user pauses',
    async (outcome) => {
      const pending = createDeferred<WorkflowRunNodeExecutionResponse>()
      mocks.run.mockReturnValue(pending.promise)
      const { result, props, rerender, client, lastRunKey, nodeData } = setup(createProps(), {
        localFileList: localFiles,
      })
      act(() => result.current.handleRunWithSyncDraft())
      await waitFor(() => expect(result.current.isPending).toBe(true))
      rerender({ ...props, isPaused: true })
      await act(async () => {
        if (outcome === 'failed') pending.reject(new Error('Run failed'))
        else pending.resolve({ id: 'run-1', status: NodeRunningStatus.Succeeded })
      })
      await waitFor(() => expect(result.current.isPending).toBe(false))
      expect(nodeData()._singleRunningStatus).toBe(NodeRunningStatus.Running)
      expect(mocks.inspect).not.toHaveBeenCalled()
      expect(props.onSuccess).not.toHaveBeenCalled()
      expect(client.getQueryState(lastRunKey)?.isInvalidated).toBe(outcome === 'failed')
    },
  )

  it('sets the chained run result without refreshing inspector variables', async () => {
    const { result, props } = setup(
      createProps({
        isRunAfterSingleRun: true,
        payload: createData({ _singleRunningStatus: NodeRunningStatus.Running }),
      }),
      { localFileList: localFiles },
    )
    act(() => result.current.handleRunWithSyncDraft())
    await waitFor(() =>
      expect(props.setRunResult).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'run-1', status: NodeRunningStatus.Succeeded }),
      ),
    )
    expect(mocks.inspect).not.toHaveBeenCalled()
    expect(props.onSuccess).not.toHaveBeenCalled()
  })
})
