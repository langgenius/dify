import type { CustomRunFormProps, DataSourceNodeType } from '../types'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  useDataSourceStore,
  useDataSourceStoreWithSelector,
} from '@/app/components/datasets/documents/create-from-pipeline/data-source/store'
import { CrawlStep } from '@/models/datasets'
import { DatasourceType, OnlineDriveFileType } from '@/models/pipeline'
import { BlockEnum } from '../../../types'
import BeforeRunForm from '../before-run-form'
import useBeforeRunForm from '../hooks/use-before-run-form'

// The provider-specific selection UIs are outside this credential/reset contract.
// Capture their real parent-owned store so stale selections can be seeded and inspected.
let dataSourceStore: ReturnType<typeof useDataSourceStore>

function CredentialAction({
  name,
  credentialId,
  onCredentialChange,
}: {
  name: string
  credentialId: string
  onCredentialChange: (id: string) => void
}) {
  dataSourceStore = useDataSourceStore()
  const currentCredentialId = useDataSourceStoreWithSelector((state) => state.currentCredentialId)
  return (
    <>
      <button type="button" onClick={() => onCredentialChange(credentialId)}>
        {name}
      </button>
      <output>{currentCredentialId}</output>
    </>
  )
}

vi.mock('@/app/components/datasets/documents/create-from-pipeline/data-source/local-file', () => ({
  __esModule: true,
  default: ({ allowedExtensions }: { allowedExtensions: string[] }) => (
    <div>{allowedExtensions.join(',')}</div>
  ),
}))

vi.mock(
  '@/app/components/datasets/documents/create-from-pipeline/data-source/online-documents',
  () => ({
    __esModule: true,
    default: ({ onCredentialChange }: { onCredentialChange: (credentialId: string) => void }) => (
      <CredentialAction
        name="online-documents"
        credentialId="credential-doc"
        onCredentialChange={onCredentialChange}
      />
    ),
  }),
)

vi.mock(
  '@/app/components/datasets/documents/create-from-pipeline/data-source/website-crawl',
  () => ({
    __esModule: true,
    default: ({ onCredentialChange }: { onCredentialChange: (credentialId: string) => void }) => (
      <CredentialAction
        name="website-crawl"
        credentialId="credential-site"
        onCredentialChange={onCredentialChange}
      />
    ),
  }),
)

vi.mock(
  '@/app/components/datasets/documents/create-from-pipeline/data-source/online-drive',
  () => ({
    __esModule: true,
    default: ({ onCredentialChange }: { onCredentialChange: (credentialId: string) => void }) => (
      <CredentialAction
        name="online-drive"
        credentialId="credential-drive"
        onCredentialChange={onCredentialChange}
      />
    ),
  }),
)

vi.mock('../hooks/use-before-run-form', () => ({
  __esModule: true,
  default: vi.fn(),
}))

const mockUseBeforeRunForm = vi.mocked(useBeforeRunForm)

const createData = (overrides: Partial<DataSourceNodeType> = {}): DataSourceNodeType => ({
  title: 'Datasource',
  desc: '',
  type: BlockEnum.DataSource,
  plugin_id: 'plugin-id',
  provider_type: DatasourceType.localFile,
  provider_name: 'file',
  datasource_name: 'local-file',
  datasource_label: 'Local File',
  datasource_parameters: {},
  datasource_configurations: {},
  fileExtensions: ['pdf', 'md'],
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

describe('data-source/before-run-form', () => {
  beforeEach(() => {
    mockUseBeforeRunForm.mockReturnValue({
      isPending: false,
      handleRunWithSyncDraft: vi.fn(),
      datasourceType: DatasourceType.localFile,
      datasourceNodeData: createData(),
      startRunBtnDisabled: false,
    })
  })

  it('renders the local-file preparation form and triggers run/cancel actions', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    const handleRunWithSyncDraft = vi.fn()

    mockUseBeforeRunForm.mockReturnValue({
      isPending: false,
      handleRunWithSyncDraft,
      datasourceType: DatasourceType.localFile,
      datasourceNodeData: createData(),
      startRunBtnDisabled: false,
    })

    render(<BeforeRunForm {...createProps({ onCancel })} />)

    expect(screen.getByText(/Datasource/)).toBeInTheDocument()
    expect(screen.getByText('pdf,md')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    await user.click(screen.getByRole('button', { name: 'workflow.singleRun.startRun' }))

    expect(onCancel).toHaveBeenCalled()
    expect(handleRunWithSyncDraft).toHaveBeenCalled()
  })

  it('clears stale online document data when switching credentials', async () => {
    const user = userEvent.setup()

    mockUseBeforeRunForm.mockReturnValue({
      isPending: false,
      handleRunWithSyncDraft: vi.fn(),
      datasourceType: DatasourceType.onlineDocument,
      datasourceNodeData: createData({ provider_type: DatasourceType.onlineDocument }),
      startRunBtnDisabled: true,
    })

    render(
      <BeforeRunForm
        {...createProps({ payload: createData({ provider_type: DatasourceType.onlineDocument }) })}
      />,
    )

    const page = {
      page_id: 'old-page',
      page_name: 'Old page',
      workspace_id: 'workspace',
      parent_id: '',
      type: 'page',
      page_icon: null,
      is_bound: true,
    }
    act(() => {
      const state = dataSourceStore.getState()
      state.setCurrentCredentialId('old-credential')
      state.setDocumentsData([
        {
          workspace_id: 'workspace',
          workspace_name: 'Old workspace',
          workspace_icon: null,
          pages: [page],
        },
      ])
      state.setSearchValue('old query')
      state.setSelectedPagesId(new Set([page.page_id]))
      state.setOnlineDocuments([page])
      state.setCurrentDocument(page)
    })
    expect(dataSourceStore.getState().previewOnlineDocumentRef.current).toEqual(page)
    await user.click(screen.getByRole('button', { name: 'online-documents' }))

    expect(dataSourceStore.getState()).toMatchObject({
      documentsData: [],
      searchValue: '',
      selectedPagesId: new Set(),
      onlineDocuments: [],
      currentDocument: undefined,
      currentCredentialId: 'credential-doc',
      previewOnlineDocumentRef: { current: undefined },
    })
    expect(screen.getByRole('status')).toHaveTextContent('credential-doc')
    expect(screen.getByRole('button', { name: 'workflow.singleRun.startRun' })).toBeDisabled()
  })

  it('clears website crawl data when switching credentials', async () => {
    const user = userEvent.setup()

    mockUseBeforeRunForm.mockReturnValue({
      isPending: false,
      handleRunWithSyncDraft: vi.fn(),
      datasourceType: DatasourceType.websiteCrawl,
      datasourceNodeData: createData({ provider_type: DatasourceType.websiteCrawl }),
      startRunBtnDisabled: false,
    })

    render(
      <BeforeRunForm
        {...createProps({ payload: createData({ provider_type: DatasourceType.websiteCrawl }) })}
      />,
    )

    const page = {
      title: 'Old site',
      markdown: 'Old content',
      description: '',
      source_url: 'https://example.com',
    }
    act(() => {
      const state = dataSourceStore.getState()
      state.setCurrentCredentialId('old-credential')
      state.setStep(CrawlStep.finished)
      state.setCrawlResult({ data: [page], time_consuming: 1 })
      state.setWebsitePages([page])
      state.setCurrentWebsite(page)
      state.setPreviewIndex(0)
    })
    expect(dataSourceStore.getState().previewWebsitePageRef.current).toEqual(page)
    await user.click(screen.getByRole('button', { name: 'website-crawl' }))

    expect(dataSourceStore.getState()).toMatchObject({
      step: CrawlStep.init,
      crawlResult: undefined,
      websitePages: [],
      currentWebsite: undefined,
      previewIndex: -1,
      currentCredentialId: 'credential-site',
      previewWebsitePageRef: { current: undefined },
    })
    expect(screen.getByRole('status')).toHaveTextContent('credential-site')
  })

  it('clears online drive data when switching credentials', async () => {
    const user = userEvent.setup()

    mockUseBeforeRunForm.mockReturnValue({
      isPending: false,
      handleRunWithSyncDraft: vi.fn(),
      datasourceType: DatasourceType.onlineDrive,
      datasourceNodeData: createData({ provider_type: DatasourceType.onlineDrive }),
      startRunBtnDisabled: false,
    })

    render(
      <BeforeRunForm
        {...createProps({ payload: createData({ provider_type: DatasourceType.onlineDrive }) })}
      />,
    )

    const file = { id: 'old-file', name: 'Old file', type: OnlineDriveFileType.file, size: 12 }
    act(() => {
      const state = dataSourceStore.getState()
      state.setCurrentCredentialId('old-credential')
      state.setOnlineDriveFileList([file])
      state.setBucket('old-bucket')
      state.setPrefix(['old-folder'])
      state.setKeywords('old query')
      state.setSelectedFileIds([file.id])
    })
    expect(dataSourceStore.getState().previewOnlineDriveFileRef.current).toEqual(file)
    await user.click(screen.getByRole('button', { name: 'online-drive' }))

    expect(dataSourceStore.getState()).toMatchObject({
      onlineDriveFileList: [],
      bucket: '',
      prefix: [],
      keywords: '',
      selectedFileIds: [],
      currentCredentialId: 'credential-drive',
      previewOnlineDriveFileRef: { current: undefined },
    })
    expect(screen.getByRole('status')).toHaveTextContent('credential-drive')
  })
})
