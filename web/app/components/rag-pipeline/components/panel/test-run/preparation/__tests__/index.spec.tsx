import type { DataSourceShape } from '@/app/components/datasets/documents/create-from-pipeline/data-source/store'
import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createDataSourceStore } from '@/app/components/datasets/documents/create-from-pipeline/data-source/store'
import { DataSourceContext } from '@/app/components/datasets/documents/create-from-pipeline/data-source/store/provider'
import { BlockEnum } from '@/app/components/workflow/types'
import { DatasourceType } from '@/models/pipeline'
import Preparation from '../index'

const sources = [
  { id: 'local', title: 'Local File', type: DatasourceType.localFile },
  { id: 'document', title: 'Online Document', type: DatasourceType.onlineDocument },
  { id: 'website', title: 'Website', type: DatasourceType.websiteCrawl },
  { id: 'drive', title: 'Online Drive', type: DatasourceType.onlineDrive },
]
const nodes = sources.map((source) => ({
  id: source.id,
  data: {
    title: source.title,
    desc: '',
    type: BlockEnum.DataSource,
    provider_type: source.type,
    provider_name: source.title,
    plugin_id: 'datasource-plugin',
    datasource_name: source.id,
    datasource_label: source.title,
    datasource_parameters: {},
    datasource_configurations: {},
    fileExtensions: ['txt', 'pdf'],
  } satisfies DataSourceNodeType,
}))
vi.mock('reactflow', () => ({ useNodes: () => nodes }))
vi.mock('@/app/components/base/amplitude', () => ({ trackEvent: vi.fn() }))
vi.mock('@/app/components/workflow/hooks/use-tool-icon', () => ({ useToolIcon: () => undefined }))
const handleRun = vi.fn()
const setIsPreparingDataSource = vi.fn()
vi.mock('@/app/components/workflow/hooks/use-workflow-run', () => ({
  useWorkflowRun: () => ({ handleRun }),
}))
vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => ({ getState: () => ({ setIsPreparingDataSource }) }),
}))

// Provider screens and the processing form have their own integration tests.
// Keep their callbacks at this boundary while exercising the real selection and store.
vi.mock('@/app/components/datasets/documents/create-from-pipeline/data-source/local-file', () => ({
  default: () => null,
}))
function ProviderScreen({ onCredentialChange }: { onCredentialChange: (id: string) => void }) {
  return (
    <button onClick={() => onCredentialChange('replacement-credential')}>Change credential</button>
  )
}
vi.mock(
  '@/app/components/datasets/documents/create-from-pipeline/data-source/online-documents',
  () => ({ default: ProviderScreen }),
)
vi.mock(
  '@/app/components/datasets/documents/create-from-pipeline/data-source/website-crawl',
  () => ({ default: ProviderScreen }),
)
vi.mock(
  '@/app/components/datasets/documents/create-from-pipeline/data-source/online-drive',
  () => ({ default: ProviderScreen }),
)
vi.mock('../document-processing', () => ({
  default: ({
    onProcess,
    onBack,
  }: {
    onProcess: (inputs: Record<string, unknown>) => void
    onBack: () => void
  }) => (
    <>
      <button onClick={() => onProcess({ limit: 5 })}>Process</button>
      <button onClick={onBack}>Back</button>
    </>
  ),
}))

const localFile = (id: string) => ({
  fileID: 'upload-1',
  progress: id ? 100 : 50,
  file: Object.assign(new File(['text'], 'guide.txt', { type: 'text/plain' }), {
    id,
    extension: 'txt',
    mime_type: 'text/plain',
  }),
})
const document = {
  workspace_id: 'workspace-1',
  page_id: 'page-1',
  page_name: 'Guide',
  page_icon: null,
  parent_id: '',
  type: 'page',
  is_bound: false,
}
const page = {
  source_url: 'https://example.com',
  title: 'Guide',
  markdown: '# Guide',
  description: '',
}
const selectedStates: Record<string, Partial<DataSourceShape>> = {
  local: { localFileList: [localFile('file-1')] },
  document: { onlineDocuments: [document] },
  website: { websitePages: [page] },
  drive: {
    selectedFileIds: ['drive-2'],
    bucket: 'documents',
    onlineDriveFileList: [
      { id: 'drive-1', name: 'Other.txt', type: 'file' },
      { id: 'drive-2', name: 'Guide.txt', type: 'file' },
    ],
  },
}
const expectedInfo: Record<string, Record<string, unknown>> = {
  local: {
    related_id: 'file-1',
    name: 'guide.txt',
    type: 'text/plain',
    size: 4,
    extension: 'txt',
    mime_type: 'text/plain',
    url: '',
    transfer_method: 'local_file',
  },
  document: {
    workspace_id: 'workspace-1',
    credential_id: 'credential-1',
    page: {
      page_id: 'page-1',
      page_name: 'Guide',
      page_icon: null,
      parent_id: '',
      type: 'page',
      is_bound: false,
    },
  },
  website: { ...page, credential_id: 'credential-1' },
  drive: {
    bucket: 'documents',
    id: 'drive-2',
    name: 'Guide.txt',
    type: 'file',
    credential_id: 'credential-1',
  },
}
const setup = () => {
  const store = createDataSourceStore()
  render(
    <DataSourceContext value={store}>
      <Preparation />
    </DataSourceContext>,
  )
  return { store, user: userEvent.setup() }
}
const next = () => screen.getByRole('button', { name: /datasetCreation.stepOne.button/ })

it.each(sources)(
  'requires a selected item before processing $title and sends its complete run payload',
  async ({ id, title, type }) => {
    const { user, store } = setup()
    await user.click(screen.getByRole('radio', { name: title }))
    expect(next()).toBeDisabled()
    await user.click(next())
    expect(screen.queryByRole('button', { name: 'Process' })).not.toBeInTheDocument()
    expect(handleRun).not.toHaveBeenCalled()
    act(() => store.setState({ ...selectedStates[id], currentCredentialId: 'credential-1' }))
    expect(next()).toBeEnabled()
    await user.click(next())
    expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent(
      'datasetPipeline.testRun.steps.documentProcessing',
    )
    await user.click(screen.getByRole('button', { name: 'Process' }))
    expect(handleRun).toHaveBeenCalledExactlyOnceWith({
      inputs: { limit: 5 },
      start_node_id: id,
      datasource_type: type,
      datasource_info_list: [expectedInfo[id]],
    })
    expect(setIsPreparingDataSource).toHaveBeenCalledWith(false)
  },
)

it('waits for a local upload to finish and uses the latest file when processing', async () => {
  const { user, store } = setup()
  act(() => store.getState().setLocalFileList([localFile('')]))
  expect(next()).toBeDisabled()
  act(() => store.getState().setLocalFileList([localFile('file-1')]))
  await user.click(next())
  act(() => store.getState().setLocalFileList([localFile('replacement-file')]))
  await user.click(screen.getByRole('button', { name: 'Process' }))
  expect(handleRun).toHaveBeenCalledWith(
    expect.objectContaining({
      datasource_info_list: [{ ...expectedInfo.local, related_id: 'replacement-file' }],
    }),
  )
})

it('returns to the selected source and clears credentials when changing source', async () => {
  const { user, store } = setup()
  act(() => store.setState({ ...selectedStates.local, currentCredentialId: 'old-credential' }))
  await user.click(next())
  await user.click(screen.getByRole('button', { name: 'Back' }))
  expect(screen.getByRole('radio', { name: 'Local File' })).toBeChecked()
  expect(next()).toBeEnabled()
  await user.click(screen.getByRole('radio', { name: 'Online Document' }))
  expect(next()).toBeDisabled()
  expect(store.getState().currentCredentialId).toBe('')
  act(() =>
    store.setState({ ...selectedStates.document, currentCredentialId: 'document-credential' }),
  )
  await user.click(next())
  await user.click(screen.getByRole('button', { name: 'Process' }))
  expect(handleRun).toHaveBeenCalledWith(
    expect.objectContaining({
      start_node_id: 'document',
      datasource_info_list: [{ ...expectedInfo.document, credential_id: 'document-credential' }],
    }),
  )
})

it.each(sources.filter((source) => source.id !== 'local'))(
  'discards $title selections when credentials change or the source is selected again',
  async ({ id, title }) => {
    const { user, store } = setup()
    await user.click(screen.getByRole('radio', { name: title }))
    act(() => store.setState({ ...selectedStates[id], currentCredentialId: 'old-credential' }))
    expect(next()).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Change credential' }))
    expect(store.getState().currentCredentialId).toBe('replacement-credential')
    expect(next()).toBeDisabled()
    act(() => store.setState(selectedStates[id]!))
    expect(next()).toBeEnabled()
    await user.click(screen.getByRole('radio', { name: 'Local File' }))
    await user.click(screen.getByRole('radio', { name: title }))
    expect(next()).toBeDisabled()
    expect(store.getState().currentCredentialId).toBe('')
    expect(handleRun).not.toHaveBeenCalled()
  },
)
