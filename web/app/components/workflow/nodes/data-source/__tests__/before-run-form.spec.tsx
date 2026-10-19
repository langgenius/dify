import type { CustomRunFormProps, DataSourceNodeType } from '../types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useDataSourceStoreWithSelector } from '@/app/components/datasets/documents/create-from-pipeline/data-source/store'
import { DatasourceType } from '@/models/pipeline'
import { BlockEnum } from '../../../types'
import BeforeRunForm from '../before-run-form'
import useBeforeRunForm from '../hooks/use-before-run-form'

const mockClearOnlineDocumentData = vi.hoisted(() => vi.fn())
const mockClearWebsiteCrawlData = vi.hoisted(() => vi.fn())
const mockClearOnlineDriveData = vi.hoisted(() => vi.fn())

function CredentialAction({
  name,
  credentialId,
  onCredentialChange,
}: {
  name: string
  credentialId: string
  onCredentialChange: (id: string) => void
}) {
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

vi.mock('@/app/components/rag-pipeline/components/panel/test-run/preparation/hooks', () => ({
  useOnlineDocument: () => ({ clearOnlineDocumentData: mockClearOnlineDocumentData }),
  useWebsiteCrawl: () => ({ clearWebsiteCrawlData: mockClearWebsiteCrawlData }),
  useOnlineDrive: () => ({ clearOnlineDriveData: mockClearOnlineDriveData }),
}))

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
    vi.clearAllMocks()
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

  it('clears stale online document data before switching credentials', async () => {
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

    await user.click(screen.getByRole('button', { name: 'online-documents' }))

    expect(mockClearOnlineDocumentData).toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('credential-doc')
    expect(screen.getByRole('button', { name: 'workflow.singleRun.startRun' })).toBeDisabled()
  })

  it('clears website crawl data before switching credentials', async () => {
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

    await user.click(screen.getByRole('button', { name: 'website-crawl' }))

    expect(mockClearWebsiteCrawlData).toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('credential-site')
  })

  it('clears online drive data before switching credentials', async () => {
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

    await user.click(screen.getByRole('button', { name: 'online-drive' }))

    expect(mockClearOnlineDriveData).toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('credential-drive')
  })
})
