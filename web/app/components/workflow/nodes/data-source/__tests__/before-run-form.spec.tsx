import type { CustomRunFormProps, DataSourceNodeType } from '../types'
import type { DataSourceShape } from '@/app/components/datasets/documents/create-from-pipeline/data-source/store'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useStoreApi } from 'reactflow'
import {
  useDataSourceStore,
  useDataSourceStoreWithSelector,
} from '@/app/components/datasets/documents/create-from-pipeline/data-source/store'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { DatasourceType } from '@/models/pipeline'
import { BlockEnum, NodeRunningStatus } from '../../../types'
import BeforeRunForm from '../before-run-form'

const run = vi.hoisted(() => vi.fn())
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'rag.pipelines.byPipelineId.workflows.draft.datasource.variablesInspect.post': run,
    }),
  }
})
vi.mock('@/service/workflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/workflow')>()),
  fetchNodeInspectVars: async () => [],
}))

const document: DataSourceShape['onlineDocuments'][number] = {
  workspace_id: 'workspace',
  page_id: 'page',
  page_name: 'Guide',
  page_icon: null,
  parent_id: '',
  type: 'page',
  is_bound: false,
}
const website: DataSourceShape['websitePages'][number] = {
  source_url: 'https://example.com',
  title: 'Guide',
  markdown: '# Guide',
  description: '',
}
const localFiles: DataSourceShape['localFileList'] = [
  {
    fileID: 'upload',
    progress: 100,
    file: Object.assign(new File(['pdf'], 'guide.pdf', { type: 'application/pdf' }), {
      id: 'file-1',
      extension: 'pdf',
      mime_type: 'application/pdf',
    }),
  },
]

// Uploading/browsing belongs to the independently tested datasource children.
// These controls exercise their public selection and credential callbacks against the real store.
function Selection({
  type,
  onCredentialChange,
  allowedExtensions,
}: {
  type: DatasourceType
  onCredentialChange?: (id: string) => void
  allowedExtensions?: string[]
}) {
  const store = useDataSourceStore()
  const credential = useDataSourceStoreWithSelector((state) => state.currentCredentialId)
  const selected = useDataSourceStoreWithSelector(
    (state) =>
      state.localFileList.length +
      state.onlineDocuments.length +
      state.websitePages.length +
      state.selectedFileIds.length,
  )
  const select = () => {
    const state = store.getState()
    if (type === DatasourceType.localFile) state.setLocalFileList(localFiles)
    if (type === DatasourceType.onlineDocument) {
      state.setOnlineDocuments([document])
      state.setSelectedPagesId(new Set(['page']))
      state.setCurrentDocument(document)
    }
    if (type === DatasourceType.websiteCrawl) {
      state.setWebsitePages([website])
      state.setCurrentWebsite(website)
      state.setPreviewIndex(0)
    }
    if (type === DatasourceType.onlineDrive) {
      state.setOnlineDriveFileList([{ id: 'drive-file', name: 'Guide', type: 'file' }])
      state.setBucket('bucket')
      state.setSelectedFileIds(['drive-file'])
    }
  }
  return (
    <>
      <span>{allowedExtensions?.join(',')}</span>
      <button type="button" onClick={select}>
        Select Guide
      </button>
      <output aria-label="Selected documents">{selected}</output>
      <output aria-label="Credential">{credential}</output>
      {onCredentialChange && (
        <button type="button" onClick={() => onCredentialChange('new-credential')}>
          Switch credential
        </button>
      )}
    </>
  )
}
vi.mock('@/app/components/datasets/documents/create-from-pipeline/data-source/local-file', () => ({
  default: (props: { allowedExtensions: string[] }) => (
    <Selection {...props} type={DatasourceType.localFile} />
  ),
}))
vi.mock(
  '@/app/components/datasets/documents/create-from-pipeline/data-source/online-documents',
  () => ({
    default: (props: { onCredentialChange: (id: string) => void }) => (
      <Selection {...props} type={DatasourceType.onlineDocument} />
    ),
  }),
)
vi.mock(
  '@/app/components/datasets/documents/create-from-pipeline/data-source/website-crawl',
  () => ({
    default: (props: { onCredentialChange: (id: string) => void }) => (
      <Selection {...props} type={DatasourceType.websiteCrawl} />
    ),
  }),
)
vi.mock(
  '@/app/components/datasets/documents/create-from-pipeline/data-source/online-drive',
  () => ({
    default: (props: { onCredentialChange: (id: string) => void }) => (
      <Selection {...props} type={DatasourceType.onlineDrive} />
    ),
  }),
)

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

function setup(props = createProps()) {
  let flow: ReturnType<typeof useStoreApi>
  function Form() {
    flow = useStoreApi()
    return <BeforeRunForm {...props} />
  }
  renderWorkflowFlowComponent(<Form />, {
    resource: props.resource,
    nodes: [createNode({ id: props.nodeId, data: props.payload })],
    hooksStoreProps: { doSyncWorkflowDraft: async (_skip, callbacks) => callbacks?.onSuccess?.() },
  })
  return { props, nodeData: () => flow.getState().getNodes()[0]!.data }
}

beforeEach(() => run.mockResolvedValue({ id: 'run-1', status: NodeRunningStatus.Succeeded }))

it('runs the selected local file and exposes cancel through the form', async () => {
  const user = userEvent.setup()
  const { props, nodeData } = setup()
  expect(screen.getByText(/Datasource/)).toBeInTheDocument()
  expect(screen.getByText('pdf,md')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Select Guide' }))
  await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
  await user.click(screen.getByRole('button', { name: 'workflow.singleRun.startRun' }))
  await waitFor(() => expect(nodeData()._singleRunningStatus).toBe(NodeRunningStatus.Succeeded))
  expect(run).toHaveBeenCalledWith({
    params: { pipeline_id: 'flow-id' },
    body: expect.objectContaining({
      start_node_id: props.nodeId,
      datasource_type: DatasourceType.localFile,
      datasource_info: expect.objectContaining({ related_id: 'file-1', name: 'guide.pdf' }),
    }),
  })
  expect(props.onCancel).toHaveBeenCalledOnce()
})

it.each([DatasourceType.onlineDocument, DatasourceType.websiteCrawl, DatasourceType.onlineDrive])(
  'clears the previous %s selection when credentials change',
  async (type) => {
    const user = userEvent.setup()
    setup(createProps({ payload: createData({ provider_type: type }) }))
    await user.click(screen.getByRole('button', { name: 'Select Guide' }))
    expect(screen.getByRole('status', { name: 'Selected documents' })).toHaveTextContent('1')
    expect(screen.getByRole('button', { name: 'workflow.singleRun.startRun' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Switch credential' }))
    expect(screen.getByRole('status', { name: 'Credential' })).toHaveTextContent('new-credential')
    expect(screen.getByRole('status', { name: 'Selected documents' })).toHaveTextContent('0')
    expect(screen.getByRole('button', { name: 'workflow.singleRun.startRun' })).toBeDisabled()
  },
)
