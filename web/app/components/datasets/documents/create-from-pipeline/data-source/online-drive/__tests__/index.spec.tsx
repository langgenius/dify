import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import type { OnlineDriveFile } from '@/models/pipeline'
import type { DataSourceNodeCompletedResponse, DataSourceNodeErrorResponse } from '@/types/pipeline'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum } from '@/app/components/workflow/types'
import { DatasourceType, OnlineDriveFileType } from '@/models/pipeline'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import { createDataSourceStore } from '../../store'
import { DataSourceContext } from '../../store/provider'
import OnlineDrive from '../index'

const { ssePost, toastError } = vi.hoisted(() => ({ ssePost: vi.fn(), toastError: vi.fn() }))
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  ssePost,
}))
vi.mock('@/app/notifications', () => ({ toast: { error: toastError } }))
vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (
    select: (state: { dataset: { pipeline_id: string } }) => unknown,
  ) => select({ dataset: { pipeline_id: 'pipeline-123' } }),
}))
const onUrlUpdate = vi.fn()
const render = createNuqsTestRenderer(renderWithConsoleQuery, () => ({ onUrlUpdate }))
const nodeData: DataSourceNodeType = {
  type: BlockEnum.DataSource,
  title: 'Drive',
  desc: '',
  provider_type: DatasourceType.onlineDrive,
  plugin_id: 'plugin-123',
  provider_name: 'drive',
  datasource_name: 'drive',
  datasource_label: 'Drive',
  datasource_parameters: {},
  datasource_configurations: {},
}
const files: OnlineDriveFile[] = [
  { id: 'file-1', name: 'Report.pdf', type: OnlineDriveFileType.file, size: 1024 },
  { id: 'file-2', name: 'Other.txt', type: OnlineDriveFileType.file, size: 500 },
  { id: 'folder-1', name: 'Archive', type: OnlineDriveFileType.folder },
]
function setup({ cached = true, credential = 'credential-1', single = false, draft = false } = {}) {
  const store = createDataSourceStore()
  store.setState({
    localFileList: [],
    onlineDriveFileList: cached ? files : [],
    currentCredentialId: credential,
    breadcrumbs: ['Root'],
    prefix: ['root'],
    bucket: 'bucket-a',
    nextPageParameters: { cursor: 'next' },
  })
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(
    consoleQuery.auth.plugin.datasource.byProviderId.get.queryOptions({
      input: { params: { provider_id: 'plugin-123/drive' } },
    }).queryKey,
    { result: [] },
  )
  render(
    <DataSourceContext value={store}>
      <OnlineDrive
        nodeId="node-1"
        nodeData={nodeData}
        onCredentialChange={vi.fn()}
        supportBatchUpload={!single}
        isInPipeline={draft}
      />
    </DataSourceContext>,
    { queryClient },
  )
  return store
}
function callbacks(): {
  onDataSourceNodeCompleted: (data: DataSourceNodeCompletedResponse) => void
  onDataSourceNodeError: (data: DataSourceNodeErrorResponse) => void
} {
  return ssePost.mock.lastCall![2]
}
beforeEach(() => vi.clearAllMocks())

it.each([true, false])(
  'loads the %s draft route and stores streamed files and pagination',
  async (draft) => {
    const store = setup({ cached: false, draft })
    await waitFor(() => expect(ssePost).toHaveBeenCalledOnce())
    expect(ssePost).toHaveBeenCalledWith(
      `/rag/pipelines/pipeline-123/workflows/${draft ? 'draft' : 'published'}/datasource/nodes/node-1/run`,
      {
        body: {
          inputs: {
            prefix: 'root',
            bucket: 'bucket-a',
            next_page_parameters: { cursor: 'next' },
            max_keys: 30,
          },
          datasource_type: DatasourceType.onlineDrive,
          credential_id: 'credential-1',
        },
      },
      expect.any(Object),
    )
    act(() =>
      callbacks().onDataSourceNodeCompleted({
        event: 'datasource_completed',
        time_consuming: 1,
        data: [
          {
            bucket: 'bucket-a',
            files: [{ id: 'new-file', name: 'New.pdf', size: 1024, type: 'file' }],
            is_truncated: true,
            next_page_parameters: { cursor: 'next-page' },
          },
        ],
      }),
    )
    expect(await screen.findByText('New.pdf')).toBeInTheDocument()
    expect(store.getState().isTruncated.current).toBe(true)
    expect(store.getState().currentNextPageParametersRef.current).toEqual({ cursor: 'next-page' })
    expect(store.getState().hasBucket).toBe(true)
  },
)

it('does not request files without a credential', () => {
  setup({ cached: false, credential: '' })
  expect(ssePost).not.toHaveBeenCalled()
})

it('uses cached files, selects them independently and clears selection when opening a folder', async () => {
  const user = userEvent.setup()
  const store = setup()
  expect(ssePost).not.toHaveBeenCalled()
  await user.click(screen.getByRole('checkbox', { name: 'Report.pdf' }))
  expect(store.getState().selectedFileIds).toEqual(['file-1'])
  expect(screen.getByRole('checkbox', { name: 'Other.txt' })).not.toBeChecked()
  await user.click(screen.getByText('Archive'))
  expect(store.getState().selectedFileIds).toEqual([])
  expect(store.getState().breadcrumbs).toEqual(['Root', 'Archive'])
  expect(store.getState().prefix).toEqual(['root', 'folder-1'])
  await waitFor(() => expect(ssePost).toHaveBeenCalledOnce())
  expect(ssePost.mock.lastCall![1].body.inputs.prefix).toBe('folder-1')
})

it('keeps a single selected file when a second file is clicked in single-upload mode', async () => {
  const user = userEvent.setup()
  const store = setup({ single: true })
  await user.click(screen.getByText('Report.pdf'))
  await user.click(screen.getByText('Other.txt'))
  expect(store.getState().selectedFileIds).toEqual(['file-1'])
})

it('reports a failed stream and opens datasource configuration', async () => {
  const user = userEvent.setup()
  setup({ cached: false })
  await waitFor(() => expect(ssePost).toHaveBeenCalledOnce())
  act(() => callbacks().onDataSourceNodeError({ event: 'datasource_error', error: 'Drive failed' }))
  expect(toastError).toHaveBeenCalledWith('Drive failed')
  await user.click(screen.getByRole('button', { name: /^datasetPipeline\.configurationTip/ }))
  await waitFor(() =>
    expect(onUrlUpdate.mock.lastCall![0].searchParams.get('settings')).toBe('data-source'),
  )
})
