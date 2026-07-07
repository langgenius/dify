import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import type { OnlineDriveFile } from '@/models/pipeline'
import type { DataSourceNodeCompletedResponse, DataSourceNodeErrorResponse } from '@/types/pipeline'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import { DatasourceType, OnlineDriveFileType } from '@/models/pipeline'
import OnlineDrive from '../index'

const mocks = vi.hoisted(() => ({
  pipelineId: 'pipeline-123' as string | undefined,
  docLink: vi.fn((path?: string) => `https://docs.example.com${path || ''}`),
  openIntegrationsSetting: vi.fn(),
  ssePost: vi.fn(),
  toastError: vi.fn(),
  useGetDataSourceAuth: vi.fn(),
}))

const mockStoreState = vi.hoisted(() => ({
  nextPageParameters: {} as Record<string, unknown>,
  breadcrumbs: [] as string[],
  prefix: [] as string[],
  keywords: '',
  bucket: '',
  selectedFileIds: [] as string[],
  onlineDriveFileList: [] as OnlineDriveFile[],
  currentCredentialId: '',
  isTruncated: { current: false },
  currentNextPageParametersRef: { current: {} as Record<string, unknown> },
  setOnlineDriveFileList: vi.fn(),
  setKeywords: vi.fn(),
  setSelectedFileIds: vi.fn(),
  setBreadcrumbs: vi.fn(),
  setPrefix: vi.fn(),
  setBucket: vi.fn(),
  setHasBucket: vi.fn(),
}))

const mockDataSourceStore = vi.hoisted(() => ({
  getState: vi.fn(() => mockStoreState),
}))

vi.mock('@/context/i18n', () => ({
  useDocLink: () => mocks.docLink,
}))

vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (
    selector: (state: { dataset: { pipeline_id: string | undefined } }) => unknown,
  ) => selector({ dataset: { pipeline_id: mocks.pipelineId } }),
}))

vi.mock('@/app/components/header/account-setting/use-integrations-setting', () => ({
  useIntegrationsSetting: () => mocks.openIntegrationsSetting,
}))

vi.mock('@/service/base', () => ({
  ssePost: (...args: unknown[]) => mocks.ssePost(...args),
}))

vi.mock('@/service/use-datasource', () => ({
  useGetDataSourceAuth: (...args: unknown[]) => mocks.useGetDataSourceAuth(...args),
}))

vi.mock('@langgenius/dify-ui/toast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@langgenius/dify-ui/toast')>()
  return {
    ...actual,
    toast: {
      ...actual.toast,
      error: (...args: unknown[]) => mocks.toastError(...args),
    },
  }
})

vi.mock('../../store', () => ({
  useDataSourceStoreWithSelector: (selector: (state: typeof mockStoreState) => unknown) => selector(mockStoreState),
  useDataSourceStore: () => mockDataSourceStore,
}))

vi.mock('../../base/header', () => ({
  default: (props: {
    docTitle: string
    docLink: string
    pluginName: string
    currentCredentialId: string
    credentials?: unknown[]
    onCredentialChange: (credentialId: string) => void
    onClickConfiguration?: () => void
  }) => (
    <div data-testid="online-drive-header">
      <span data-testid="header-doc-title">{props.docTitle}</span>
      <span data-testid="header-doc-link">{props.docLink}</span>
      <span data-testid="header-plugin-name">{props.pluginName}</span>
      <span data-testid="header-credential-id">{props.currentCredentialId}</span>
      <span data-testid="header-credentials-count">{props.credentials?.length || 0}</span>
      <button type="button" onClick={() => props.onCredentialChange('credential-2')}>Change Credential</button>
      <button type="button" onClick={props.onClickConfiguration}>Configure</button>
    </div>
  ),
}))

vi.mock('../file-list', () => ({
  default: (props: {
    fileList: OnlineDriveFile[]
    selectedFileIds: string[]
    breadcrumbs: string[]
    keywords: string
    bucket: string
    isInPipeline: boolean
    isLoading: boolean
    supportBatchUpload: boolean
    resetKeywords: () => void
    updateKeywords: (keywords: string) => void
    handleSelectFile: (file: OnlineDriveFile) => void
    handleOpenFolder: (file: OnlineDriveFile) => void
  }) => (
    <div data-testid="online-drive-file-list">
      <span data-testid="file-list-count">{props.fileList.length}</span>
      <span data-testid="file-list-selected-count">{props.selectedFileIds.length}</span>
      <span data-testid="file-list-breadcrumbs">{props.breadcrumbs.join('/')}</span>
      <span data-testid="file-list-keywords">{props.keywords}</span>
      <span data-testid="file-list-bucket">{props.bucket}</span>
      <span data-testid="file-list-loading">{String(props.isLoading)}</span>
      <span data-testid="file-list-in-pipeline">{String(props.isInPipeline)}</span>
      <span data-testid="file-list-support-batch">{String(props.supportBatchUpload)}</span>
      <button type="button" onClick={() => props.updateKeywords('report')}>Search</button>
      <button type="button" onClick={props.resetKeywords}>Reset Search</button>
      <button
        type="button"
        onClick={() => props.handleSelectFile({ id: 'file-1', name: 'Report.pdf', type: OnlineDriveFileType.file })}
      >
        Select File
      </button>
      <button
        type="button"
        onClick={() => props.handleSelectFile({ id: 'bucket-1', name: 'Bucket', type: OnlineDriveFileType.bucket })}
      >
        Select Bucket
      </button>
      <button
        type="button"
        onClick={() => props.handleOpenFolder({ id: 'folder-prefix', name: 'Folder', type: OnlineDriveFileType.folder })}
      >
        Open Folder
      </button>
      <button
        type="button"
        onClick={() => props.handleOpenFolder({ id: 'bucket-id', name: 'Bucket', type: OnlineDriveFileType.bucket })}
      >
        Open Bucket
      </button>
      <button
        type="button"
        onClick={() => props.handleOpenFolder({ id: 'file-1', name: 'Report.pdf', type: OnlineDriveFileType.file })}
      >
        Open File
      </button>
    </div>
  ),
}))

const createNodeData = (overrides: Partial<DataSourceNodeType> = {}): DataSourceNodeType => ({
  title: 'Online Drive Node',
  plugin_id: 'plugin-123',
  provider_type: 'online_drive',
  provider_name: 'online-drive-provider',
  datasource_name: 'online-drive-datasource',
  datasource_label: 'Online Drive',
  datasource_parameters: {},
  datasource_configurations: {},
  ...overrides,
} as DataSourceNodeType)

const createCredential = (id = 'credential-1') => ({
  id,
  name: `Credential ${id}`,
  avatar_url: '',
  credential: {},
  is_default: id === 'credential-1',
  type: 'oauth2',
})

const createOnlineDriveFile = (overrides: Partial<OnlineDriveFile> = {}): OnlineDriveFile => ({
  id: 'file-existing',
  name: 'Existing.txt',
  type: OnlineDriveFileType.file,
  size: 100,
  ...overrides,
})

const renderOnlineDrive = (props: Partial<React.ComponentProps<typeof OnlineDrive>> = {}) => {
  return render(
    <OnlineDrive
      nodeId="node-1"
      nodeData={createNodeData()}
      onCredentialChange={vi.fn()}
      {...props}
    />,
  )
}

const resetStoreState = () => {
  mockStoreState.nextPageParameters = {}
  mockStoreState.breadcrumbs = []
  mockStoreState.prefix = []
  mockStoreState.keywords = ''
  mockStoreState.bucket = ''
  mockStoreState.selectedFileIds = []
  mockStoreState.onlineDriveFileList = []
  mockStoreState.currentCredentialId = ''
  mockStoreState.isTruncated = { current: false }
  mockStoreState.currentNextPageParametersRef = { current: {} }
  mockStoreState.setOnlineDriveFileList = vi.fn()
  mockStoreState.setKeywords = vi.fn()
  mockStoreState.setSelectedFileIds = vi.fn()
  mockStoreState.setBreadcrumbs = vi.fn()
  mockStoreState.setPrefix = vi.fn()
  mockStoreState.setBucket = vi.fn()
  mockStoreState.setHasBucket = vi.fn()
  mockDataSourceStore.getState.mockReturnValue(mockStoreState)
}

describe('OnlineDrive', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.pipelineId = 'pipeline-123'
    resetStoreState()
    mocks.useGetDataSourceAuth.mockReturnValue({
      data: {
        result: [createCredential()],
      },
    })
  })

  it('should render header and file list with current store state', () => {
    mockStoreState.currentCredentialId = 'credential-1'
    mockStoreState.onlineDriveFileList = [createOnlineDriveFile()]
    mockStoreState.selectedFileIds = ['file-existing']
    mockStoreState.keywords = 'existing'
    mockStoreState.bucket = 'bucket-a'

    renderOnlineDrive({
      nodeData: createNodeData({ datasource_label: 'Google Drive' }),
      isInPipeline: true,
      supportBatchUpload: false,
    })

    expect(screen.getByTestId('header-doc-title')).toHaveTextContent('Docs')
    expect(screen.getByTestId('header-doc-link')).toHaveTextContent(
      'https://docs.example.com/use-dify/knowledge/knowledge-pipeline/authorize-data-source',
    )
    expect(screen.getByTestId('header-plugin-name')).toHaveTextContent('Google Drive')
    expect(screen.getByTestId('header-credential-id')).toHaveTextContent('credential-1')
    expect(screen.getByTestId('header-credentials-count')).toHaveTextContent('1')
    expect(screen.getByTestId('file-list-count')).toHaveTextContent('1')
    expect(screen.getByTestId('file-list-selected-count')).toHaveTextContent('1')
    expect(screen.getByTestId('file-list-keywords')).toHaveTextContent('existing')
    expect(screen.getByTestId('file-list-bucket')).toHaveTextContent('bucket-a')
    expect(screen.getByTestId('file-list-in-pipeline')).toHaveTextContent('true')
    expect(screen.getByTestId('file-list-support-batch')).toHaveTextContent('false')
  })

  it('should fetch files on initial mount with draft datasource URL and request body', async () => {
    mockStoreState.currentCredentialId = 'credential-1'
    mockStoreState.nextPageParameters = { cursor: 'next' }
    mockStoreState.prefix = ['root', 'folder']
    mockStoreState.bucket = 'bucket-a'

    renderOnlineDrive({
      isInPipeline: true,
    })

    await waitFor(() => expect(mocks.ssePost).toHaveBeenCalledTimes(1))
    expect(mocks.ssePost).toHaveBeenCalledWith(
      '/rag/pipelines/pipeline-123/workflows/draft/datasource/nodes/node-1/run',
      {
        body: {
          inputs: {
            prefix: 'folder',
            bucket: 'bucket-a',
            next_page_parameters: { cursor: 'next' },
            max_keys: 30,
          },
          datasource_type: DatasourceType.onlineDrive,
          credential_id: 'credential-1',
        },
      },
      expect.objectContaining({
        onDataSourceNodeCompleted: expect.any(Function),
        onDataSourceNodeError: expect.any(Function),
      }),
    )
  })

  it('should store completed response files and pagination metadata', async () => {
    mockStoreState.currentCredentialId = 'credential-1'
    renderOnlineDrive()

    await waitFor(() => expect(mocks.ssePost).toHaveBeenCalledTimes(1))
    const callbacks = mocks.ssePost.mock.calls[0]![2] as {
      onDataSourceNodeCompleted: (response: DataSourceNodeCompletedResponse) => void
    }

    callbacks.onDataSourceNodeCompleted({
      data: [
        {
          bucket: 'bucket-a',
          files: [
            { id: 'new-file', name: 'New.pdf', size: 1024, type: 'file' },
          ],
          is_truncated: true,
          next_page_parameters: { cursor: 'next-page' },
        },
      ],
    } as DataSourceNodeCompletedResponse)

    expect(mockStoreState.setOnlineDriveFileList).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'new-file', name: 'New.pdf' }),
    ])
    expect(mockStoreState.isTruncated.current).toBe(true)
    expect(mockStoreState.currentNextPageParametersRef.current).toEqual({ cursor: 'next-page' })
    expect(mockStoreState.setHasBucket).toHaveBeenCalledWith(true)
  })

  it('should show a toast when datasource request fails', async () => {
    mockStoreState.currentCredentialId = 'credential-1'
    renderOnlineDrive()

    await waitFor(() => expect(mocks.ssePost).toHaveBeenCalledTimes(1))
    const callbacks = mocks.ssePost.mock.calls[0]![2] as {
      onDataSourceNodeError: (response: DataSourceNodeErrorResponse) => void
    }

    callbacks.onDataSourceNodeError({ error: 'Drive failed' } as DataSourceNodeErrorResponse)

    expect(mocks.toastError).toHaveBeenCalledWith('Drive failed')
  })

  it('should not fetch files without a selected credential or when cached files already exist on mount', async () => {
    renderOnlineDrive()

    await waitFor(() => expect(mocks.ssePost).not.toHaveBeenCalled())

    mockStoreState.currentCredentialId = 'credential-1'
    mockStoreState.onlineDriveFileList = [createOnlineDriveFile()]
    renderOnlineDrive()

    await waitFor(() => expect(mocks.ssePost).not.toHaveBeenCalled())
  })

  it('should update selected files while respecting bucket and single-select rules', () => {
    mockStoreState.currentCredentialId = 'credential-1'
    mockStoreState.selectedFileIds = ['existing-file']

    renderOnlineDrive({
      supportBatchUpload: false,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Select File' }))
    expect(mockStoreState.setSelectedFileIds).toHaveBeenCalledWith(['existing-file'])

    fireEvent.click(screen.getByRole('button', { name: 'Select Bucket' }))
    expect(mockStoreState.setSelectedFileIds).toHaveBeenCalledTimes(1)
  })

  it('should update breadcrumbs for folders and bucket name for buckets', () => {
    mockStoreState.currentCredentialId = 'credential-1'
    mockStoreState.breadcrumbs = ['Root']
    mockStoreState.prefix = ['root-prefix']
    mockStoreState.selectedFileIds = ['file-1']

    renderOnlineDrive()

    fireEvent.click(screen.getByRole('button', { name: 'Open Folder' }))

    expect(mockStoreState.setOnlineDriveFileList).toHaveBeenCalledWith([])
    expect(mockStoreState.setSelectedFileIds).toHaveBeenCalledWith([])
    expect(mockStoreState.setBreadcrumbs).toHaveBeenCalledWith(['Root', 'Folder'])
    expect(mockStoreState.setPrefix).toHaveBeenCalledWith(['root-prefix', 'folder-prefix'])

    fireEvent.click(screen.getByRole('button', { name: 'Open Bucket' }))
    expect(mockStoreState.setBucket).toHaveBeenCalledWith('Bucket')

    fireEvent.click(screen.getByRole('button', { name: 'Open File' }))
    expect(mockStoreState.setBucket).toHaveBeenCalledTimes(1)
  })

  it('should open integrations settings and forward credential changes', () => {
    const onCredentialChange = vi.fn()
    renderOnlineDrive({
      onCredentialChange,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Configure' }))
    fireEvent.click(screen.getByRole('button', { name: 'Change Credential' }))

    expect(mocks.openIntegrationsSetting).toHaveBeenCalledWith({
      payload: ACCOUNT_SETTING_TAB.DATA_SOURCE,
    })
    expect(onCredentialChange).toHaveBeenCalledWith('credential-2')
  })
})
