import type { CustomRunFormProps, DataSourceNodeType } from '../../types'
import type { NodeRunResult, VarInInspect } from '@/types/workflow'
import { act } from '@testing-library/react'
import { useStoreApi } from 'reactflow'
import {
  useDataSourceStore,
  useDataSourceStoreWithSelector,
} from '@/app/components/datasets/documents/create-from-pipeline/data-source/store'
import { renderEditorHook as renderHook } from '@/app/components/workflow/editor-resource/__tests__/render'
import { BlockEnum, NodeRunningStatus } from '@/app/components/workflow/types'
import { DatasourceType } from '@/models/pipeline'
import { useDatasourceSingleRun } from '@/service/use-pipeline'
import { useInvalidateLastRun } from '@/service/use-workflow'
import { fetchNodeInspectVars } from '@/service/workflow'
import { TransferMethod } from '@/types/app'
import { useNodeDataUpdate } from '../../../../hooks/use-node-data-update'
import { useNodesSyncDraft } from '../../../../hooks/use-nodes-sync-draft'
import useBeforeRunForm from '../use-before-run-form'

type DataSourceStoreState = {
  currentNodeIdRef: { current: string }
  currentCredentialId: string
  setCurrentCredentialId: (credentialId: string) => void
  currentCredentialIdRef: { current: string }
  localFileList: Array<{
    file: {
      id: string
      name: string
      type: string
      size: number
      extension: string
      mime_type: string
    }
  }>
  onlineDocuments: Array<Record<string, unknown>>
  websitePages: Array<Record<string, unknown>>
  selectedFileIds: string[]
  onlineDriveFileList: Array<{ id: string; type: string }>
  bucket?: string
}

type DatasourceSingleRunOptions = {
  onError?: () => void
  onSettled?: (data?: NodeRunResult) => void
}

const mockHandleNodeDataUpdate = vi.hoisted(() => vi.fn())
const mockHandleSyncWorkflowDraft = vi.hoisted(() => vi.fn())
const mockMutateAsync = vi.hoisted(() => vi.fn())
const mockInvalidLastRun = vi.hoisted(() => vi.fn())
const mockFetchNodeInspectVars = vi.hoisted(() => vi.fn())
const mockUseDataSourceStore = vi.hoisted(() => vi.fn())
const mockUseDataSourceStoreWithSelector = vi.hoisted(() => vi.fn())

vi.mock('reactflow', async () => {
  const actual = await vi.importActual<typeof import('reactflow')>('reactflow')
  return {
    ...actual,
    useStoreApi: vi.fn(),
  }
})

vi.mock('../../../../hooks/use-node-data-update', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../hooks/use-node-data-update')>()

  return {
    ...actual,
    useNodeDataUpdate: vi.fn(),
  }
})

vi.mock('../../../../hooks/use-nodes-sync-draft', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../hooks/use-nodes-sync-draft')>()

  return {
    ...actual,
    useNodesSyncDraft: vi.fn(),
  }
})

vi.mock('@/service/use-pipeline', () => ({
  useDatasourceSingleRun: vi.fn(),
}))

vi.mock('@/service/use-workflow', () => ({
  useInvalidateLastRun: vi.fn(),
}))

vi.mock('@/service/workflow', () => ({
  fetchNodeInspectVars: vi.fn(),
}))

vi.mock('@/app/components/datasets/documents/create-from-pipeline/data-source/store', () => ({
  useDataSourceStore: vi.fn(),
  useDataSourceStoreWithSelector: vi.fn(),
}))

const mockUseStoreApi = vi.mocked(useStoreApi)
const mockUseNodeDataUpdateHook = vi.mocked(useNodeDataUpdate)
const mockUseNodesSyncDraftHook = vi.mocked(useNodesSyncDraft)
const mockUseDatasourceSingleRunHook = vi.mocked(useDatasourceSingleRun)
const mockUseInvalidLastRunHook = vi.mocked(useInvalidateLastRun)
const mockFetchNodeInspectVarsFn = vi.mocked(fetchNodeInspectVars)
const mockUseDataSourceStoreHook = vi.mocked(useDataSourceStore)
const mockUseDataSourceStoreWithSelectorHook = vi.mocked(useDataSourceStoreWithSelector)

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

describe('data-source/hooks/use-before-run-form', () => {
  let dataSourceStoreState: DataSourceStoreState

  beforeEach(() => {
    vi.clearAllMocks()

    dataSourceStoreState = {
      currentNodeIdRef: { current: 'data-source-node' },
      currentCredentialId: 'credential-1',
      setCurrentCredentialId: vi.fn(),
      currentCredentialIdRef: { current: 'credential-1' },
      localFileList: [],
      onlineDocuments: [],
      websitePages: [],
      selectedFileIds: [],
      onlineDriveFileList: [],
      bucket: 'drive-bucket',
    }

    mockUseStoreApi.mockReturnValue({
      getState: () => ({
        getNodes: () => [
          {
            id: 'data-source-node',
            data: {
              title: 'Datasource',
            },
          },
        ],
      }),
    } as ReturnType<typeof useStoreApi>)

    mockUseNodeDataUpdateHook.mockReturnValue({
      handleNodeDataUpdate: mockHandleNodeDataUpdate,
      handleNodeDataUpdateWithSyncDraft: vi.fn(),
    } as ReturnType<typeof useNodeDataUpdate>)
    mockUseNodesSyncDraftHook.mockReturnValue({
      handleSyncWorkflowDraft: (...args: unknown[]) => {
        mockHandleSyncWorkflowDraft(...args)
        const callbacks = args[2] as { onSuccess?: () => void } | undefined
        callbacks?.onSuccess?.()
      },
    } as ReturnType<typeof useNodesSyncDraft>)
    mockUseDatasourceSingleRunHook.mockReturnValue({
      mutateAsync: (...args: unknown[]) => mockMutateAsync(...args),
      isPending: false,
    } as ReturnType<typeof useDatasourceSingleRun>)
    mockUseInvalidLastRunHook.mockReturnValue(mockInvalidLastRun)
    mockFetchNodeInspectVarsFn.mockImplementation((...args: unknown[]) =>
      mockFetchNodeInspectVars(...args),
    )
    mockUseDataSourceStoreHook.mockImplementation(() => mockUseDataSourceStore())
    mockUseDataSourceStoreWithSelectorHook.mockImplementation((selector) =>
      mockUseDataSourceStoreWithSelector(
        selector as unknown as (state: DataSourceStoreState) => unknown,
      ),
    )

    mockUseDataSourceStore.mockImplementation(() => ({
      getState: () => dataSourceStoreState,
    }))
    mockUseDataSourceStoreWithSelector.mockImplementation(
      (selector: (state: DataSourceStoreState) => unknown) => selector(dataSourceStoreState),
    )
    mockFetchNodeInspectVars.mockResolvedValue([{ name: 'metadata' }] as VarInInspect[])
  })

  it('derives the run button disabled state from the selected datasource payload', () => {
    const { result, rerender } = renderHook(
      ({ payload }) => useBeforeRunForm(createProps({ payload })),
      {
        resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
        initialProps: {
          payload: createData(),
        },
      },
    )

    expect(result.current.startRunBtnDisabled).toBe(true)

    dataSourceStoreState.localFileList = [
      {
        file: {
          id: 'file-1',
          name: 'doc.pdf',
          type: 'document',
          size: 12,
          extension: 'pdf',
          mime_type: 'application/pdf',
        },
      },
    ]
    rerender({ payload: createData() })
    expect(result.current.startRunBtnDisabled).toBe(false)

    dataSourceStoreState.selectedFileIds = []
    rerender({
      payload: createData({
        provider_type: DatasourceType.onlineDrive,
      }),
    })
    expect(result.current.startRunBtnDisabled).toBe(true)
  })

  it('syncs the draft, runs the datasource, and appends inspect vars on success', async () => {
    dataSourceStoreState.localFileList = [
      {
        file: {
          id: 'file-1',
          name: 'doc.pdf',
          type: 'document',
          size: 12,
          extension: 'pdf',
          mime_type: 'application/pdf',
        },
      },
    ]

    mockMutateAsync.mockImplementation((payload: unknown, options: DatasourceSingleRunOptions) => {
      options.onSettled?.({ status: NodeRunningStatus.Succeeded } as NodeRunResult)
      return Promise.resolve(payload)
    })

    const props = createProps()
    const { result } = renderHook(() => useBeforeRunForm(props), {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })

    await act(async () => {
      result.current.handleRunWithSyncDraft()
      await Promise.resolve()
    })

    expect(props.setIsRunAfterSingleRun).toHaveBeenCalledWith(true)
    expect(mockHandleNodeDataUpdate).toHaveBeenNthCalledWith(1, {
      id: 'data-source-node',
      data: expect.objectContaining({
        _singleRunningStatus: NodeRunningStatus.Running,
      }),
    })
    expect(mockMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        pipeline_id: 'flow-id',
        start_node_id: 'data-source-node',
        datasource_type: DatasourceType.localFile,
        datasource_info: expect.objectContaining({
          related_id: 'file-1',
          transfer_method: TransferMethod.local_file,
        }),
      }),
      expect.any(Object),
    )
    expect(mockFetchNodeInspectVars).toHaveBeenCalledWith(
      { kind: 'knowledge-pipeline', pipelineId: 'flow-id' },
      'data-source-node',
    )
    expect(props.appendNodeInspectVars).toHaveBeenCalledWith(
      'data-source-node',
      [{ name: 'metadata' }],
      [
        {
          id: 'data-source-node',
          data: {
            title: 'Datasource',
          },
        },
      ],
    )
    expect(props.onSuccess).toHaveBeenCalled()
    expect(mockHandleNodeDataUpdate).toHaveBeenLastCalledWith({
      id: 'data-source-node',
      data: expect.objectContaining({
        _isSingleRun: false,
        _singleRunningStatus: NodeRunningStatus.Succeeded,
      }),
    })
  })

  it('marks the last run invalid and updates the node to failed when the single run errors', async () => {
    dataSourceStoreState.selectedFileIds = ['drive-file-1']
    dataSourceStoreState.onlineDriveFileList = [
      {
        id: 'drive-file-1',
        type: 'file',
      },
    ]

    mockMutateAsync.mockImplementation((_payload: unknown, options: DatasourceSingleRunOptions) => {
      options.onError?.()
      return Promise.resolve(undefined)
    })

    const { result } = renderHook(
      () =>
        useBeforeRunForm(
          createProps({
            payload: createData({
              provider_type: DatasourceType.onlineDrive,
            }),
          }),
        ),
      { resource: { kind: 'app', appId: 'app-1', mode: 'workflow' } },
    )

    await act(async () => {
      result.current.handleRunWithSyncDraft()
      await Promise.resolve()
    })

    expect(mockInvalidLastRun).toHaveBeenCalled()
    expect(mockHandleNodeDataUpdate).toHaveBeenLastCalledWith({
      id: 'data-source-node',
      data: expect.objectContaining({
        _isSingleRun: false,
        _singleRunningStatus: NodeRunningStatus.Failed,
      }),
    })
  })
})
