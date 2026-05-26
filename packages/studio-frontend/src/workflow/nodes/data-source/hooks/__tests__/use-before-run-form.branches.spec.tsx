import type { CustomRunFormProps, DataSourceNodeType } from '../../types'
import type { NodeRunResult, VarInInspect } from '@/types/workflow'
import { act, renderHook } from '@testing-library/react'
import { useStoreApi } from 'reactflow'
import { useDataSourceStore, useDataSourceStoreWithSelector } from '@/app/components/datasets/documents/create-from-pipeline/data-source/store'
import { BlockEnum, NodeRunningStatus } from '@/app/components/workflow/types'
import { DatasourceType } from '@/models/pipeline'
import { useDatasourceSingleRun } from '@/service/use-pipeline'
import { useInvalidLastRun } from '@/service/use-workflow'
import { fetchNodeInspectVars } from '@/service/workflow'
import { FlowType } from '@/types/common'
import { useNodeDataUpdate, useNodesSyncDraft } from '../../../../hooks'
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
  onlineDriveFileList: Array<{ id: string, type: string }>
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

vi.mock('@/app/components/workflow/hooks', () => ({
  useNodeDataUpdate: vi.fn(),
  useNodesSyncDraft: vi.fn(),
}))

vi.mock('@/service/use-pipeline', () => ({
  useDatasourceSingleRun: vi.fn(),
}))

vi.mock('@/service/use-workflow', () => ({
  useInvalidLastRun: vi.fn(),
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
const mockUseInvalidLastRunHook = vi.mocked(useInvalidLastRun)
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
  flowId: 'flow-id',
  flowType: FlowType.ragPipeline,
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

describe('data-source/hooks/use-before-run-form branches', () => {
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
        getNodes: () => [{ id: 'data-source-node', data: { title: 'Datasource' } }],
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
    mockFetchNodeInspectVarsFn.mockImplementation((...args: unknown[]) => mockFetchNodeInspectVars(...args))
    mockUseDataSourceStoreHook.mockImplementation(() => mockUseDataSourceStore())
    mockUseDataSourceStoreWithSelectorHook.mockImplementation(selector =>
      mockUseDataSourceStoreWithSelector(selector as unknown as (state: DataSourceStoreState) => unknown))

    mockUseDataSourceStore.mockImplementation(() => ({
      getState: () => dataSourceStoreState,
    }))
    mockUseDataSourceStoreWithSelector.mockImplementation((selector: (state: DataSourceStoreState) => unknown) =>
      selector(dataSourceStoreState))
    mockFetchNodeInspectVars.mockResolvedValue([{ name: 'metadata' }] as VarInInspect[])
  })

  it('derives disabled states for online documents and website crawl sources', () => {
    const { result, rerender } = renderHook(
      ({ payload }) => useBeforeRunForm(createProps({ payload })),
      {
        initialProps: {
          payload: createData({ provider_type: DatasourceType.onlineDocument }),
        },
      },
    )

    expect(result.current.startRunBtnDisabled).toBe(true)

    dataSourceStoreState.onlineDocuments = [{
      workspace_id: 'workspace-1',
      id: 'doc-1',
      title: 'Document',
    }]
    rerender({ payload: createData({ provider_type: DatasourceType.onlineDocument }) })
    expect(result.current.startRunBtnDisabled).toBe(false)

    rerender({ payload: createData({ provider_type: DatasourceType.websiteCrawl }) })
    expect(result.current.startRunBtnDisabled).toBe(true)

    dataSourceStoreState.websitePages = [{ url: 'https://example.com' }]
    rerender({ payload: createData({ provider_type: DatasourceType.websiteCrawl }) })
    expect(result.current.startRunBtnDisabled).toBe(false)
  })

  it('returns the settled run result directly when chained single-run execution should stop', async () => {
    dataSourceStoreState.localFileList = [{
      file: {
        id: 'file-1',
        name: 'doc.pdf',
        type: 'document',
        size: 12,
        extension: 'pdf',
        mime_type: 'application/pdf',
      },
    }]

    mockMutateAsync.mockImplementation((_payload: unknown, options: DatasourceSingleRunOptions) => {
      options.onSettled?.({ status: NodeRunningStatus.Succeeded } as NodeRunResult)
      return Promise.resolve(undefined)
    })

    const props = createProps({
      isRunAfterSingleRun: true,
      payload: createData({
        _singleRunningStatus: NodeRunningStatus.Running,
      } as Partial<DataSourceNodeType>),
    })
    const { result } = renderHook(() => useBeforeRunForm(props))

    await act(async () => {
      result.current.handleRunWithSyncDraft()
      await Promise.resolve()
    })

    expect(props.setRunResult).toHaveBeenCalledWith({ status: NodeRunningStatus.Succeeded })
    expect(mockFetchNodeInspectVars).not.toHaveBeenCalled()
    expect(props.onSuccess).not.toHaveBeenCalled()
  })

  it('builds online document datasource info before running', async () => {
    dataSourceStoreState.onlineDocuments = [{
      workspace_id: 'workspace-1',
      id: 'doc-1',
      title: 'Document',
      url: 'https://example.com/doc',
    }]

    mockMutateAsync.mockImplementation((payload: unknown, options: DatasourceSingleRunOptions) => {
      options.onSettled?.({ status: NodeRunningStatus.Succeeded } as NodeRunResult)
      return Promise.resolve(payload)
    })

    const { result } = renderHook(() => useBeforeRunForm(createProps({
      payload: createData({ provider_type: DatasourceType.onlineDocument }),
    })))

    await act(async () => {
      result.current.handleRunWithSyncDraft()
      await Promise.resolve()
    })

    expect(mockMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      datasource_type: DatasourceType.onlineDocument,
      datasource_info: {
        workspace_id: 'workspace-1',
        page: {
          id: 'doc-1',
          title: 'Document',
          url: 'https://example.com/doc',
        },
        credential_id: 'credential-1',
      },
    }), expect.any(Object))
  })

  it('builds website crawl datasource info and skips the failure update while paused', async () => {
    dataSourceStoreState.websitePages = [{
      url: 'https://example.com',
      title: 'Example',
    }]

    mockMutateAsync.mockImplementation((payload: unknown, options: DatasourceSingleRunOptions) => {
      options.onError?.()
      return Promise.resolve(payload)
    })

    const { result } = renderHook(() => useBeforeRunForm(createProps({
      isPaused: true,
      payload: createData({ provider_type: DatasourceType.websiteCrawl }),
    })))

    await act(async () => {
      result.current.handleRunWithSyncDraft()
      await Promise.resolve()
    })

    expect(mockMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      datasource_type: DatasourceType.websiteCrawl,
      datasource_info: {
        url: 'https://example.com',
        title: 'Example',
        credential_id: 'credential-1',
      },
    }), expect.any(Object))
    expect(mockInvalidLastRun).toHaveBeenCalled()
    expect(mockHandleNodeDataUpdate).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        _singleRunningStatus: NodeRunningStatus.Failed,
      }),
    }))
  })
})
