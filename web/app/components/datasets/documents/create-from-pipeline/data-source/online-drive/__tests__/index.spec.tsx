import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import type { OnlineDriveFile } from '@/models/pipeline'
import type { DataSourceNodeCompletedResponse, DataSourceNodeErrorResponse } from '@/types/pipeline'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum } from '@/app/components/workflow/types'
import { DatasourceType, OnlineDriveFileType } from '@/models/pipeline'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { apiError } from '@/test/fake-api'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import { createDataSourceStore } from '../../store'
import { DataSourceContext } from '../../store/provider'
import OnlineDrive from '../index'

const streamEvents = vi.hoisted(() => vi.fn<typeof import('@/service/event-stream').streamEvents>())
const runNode = vi.hoisted(() => vi.fn())
const getAuth = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())
vi.mock('@/service/event-stream', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/event-stream')>()),
  streamEvents,
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses, withConsoleResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'rag.pipelines.byPipelineId.workflows.draft.datasource.nodes.byNodeId.run.post': (
        input: unknown,
        options?: unknown,
      ) => runNode('draft', input, options),
      'rag.pipelines.byPipelineId.workflows.published.datasource.nodes.byNodeId.run.post': (
        input: unknown,
        options?: unknown,
      ) => runNode('published', input, options),
    }),
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'auth.plugin.datasource.byProviderId.get': getAuth,
    }),
  }
})
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
function setup({
  cached = true,
  credential = 'credential-1',
  single = false,
  draft = false,
  seedAuth = true,
} = {}) {
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
  if (seedAuth)
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
  return streamEvents.mock.lastCall![1] as ReturnType<typeof callbacks>
}
/** Sends the last stream request and returns the stubbed run route and its input. */
function lastRun() {
  void streamEvents.mock.lastCall![0]({
    signal: new AbortController().signal,
    context: { stream: true },
  })
  return runNode.mock.lastCall!.slice(0, 2)
}
beforeEach(() => vi.clearAllMocks())

it.each([true, false])(
  'loads the %s draft route and stores streamed files and pagination',
  async (draft) => {
    const store = setup({ cached: false, draft })
    await waitFor(() => expect(streamEvents).toHaveBeenCalledOnce())
    expect(lastRun()).toEqual([
      draft ? 'draft' : 'published',
      {
        params: { pipeline_id: 'pipeline-123', node_id: 'node-1' },
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
    ])
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
  expect(streamEvents).not.toHaveBeenCalled()
})

it('uses cached files, selects them independently and clears selection when opening a folder', async () => {
  const user = userEvent.setup()
  const store = setup()
  expect(streamEvents).not.toHaveBeenCalled()
  await user.click(screen.getByRole('checkbox', { name: 'Report.pdf' }))
  expect(store.getState().selectedFileIds).toEqual(['file-1'])
  expect(screen.getByRole('checkbox', { name: 'Other.txt' })).not.toBeChecked()
  await user.click(screen.getByText('Archive'))
  expect(store.getState().selectedFileIds).toEqual([])
  expect(store.getState().breadcrumbs).toEqual(['Root', 'Archive'])
  expect(store.getState().prefix).toEqual(['root', 'folder-1'])
  await waitFor(() => expect(streamEvents).toHaveBeenCalledOnce())
  expect(lastRun()[1]).toMatchObject({ body: { inputs: { prefix: 'folder-1' } } })
})

it('shows the selected file and switches selection in single-upload mode', async () => {
  const user = userEvent.setup()
  setup({ single: true })
  await user.click(screen.getByText('Report.pdf'))
  expect(screen.getByRole('radio', { name: 'Report.pdf' })).toBeChecked()
  await user.click(screen.getByText('Other.txt'))
  expect(screen.getByRole('radio', { name: 'Other.txt' })).toBeChecked()
  expect(screen.getByRole('radio', { name: 'Report.pdf' })).not.toBeChecked()
  await user.click(screen.getByRole('radio', { name: 'Report.pdf' }))
  expect(screen.getByRole('radio', { name: 'Report.pdf' })).toBeChecked()
  await user.click(screen.getByText('Report.pdf'))
  expect(screen.getByRole('radio', { name: 'Report.pdf' })).toBeChecked()
})

it('reports a failed stream and opens datasource configuration', async () => {
  const user = userEvent.setup()
  setup({ cached: false })
  await waitFor(() => expect(streamEvents).toHaveBeenCalledOnce())
  act(() => callbacks().onDataSourceNodeError({ event: 'datasource_error', error: 'Drive failed' }))
  expect(toastError).toHaveBeenCalledWith('Drive failed')
  await user.click(screen.getByRole('button', { name: /^datasetPipeline\.configurationTip/ }))
  await waitFor(() =>
    expect(onUrlUpdate.mock.lastCall![0].searchParams.get('settings')).toBe('data-source'),
  )
})

it('shows a failed credential load with a retry instead of an unauthorized source', async () => {
  const user = userEvent.setup()
  getAuth
    .mockRejectedValueOnce(apiError({ status: 503, message: 'Credentials unavailable' }))
    .mockResolvedValue({ result: [] })
  setup({ seedAuth: false })

  expect(await screen.findByRole('alert')).toHaveTextContent('dataset.loadError')
  await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  expect(getAuth).toHaveBeenCalledTimes(2)
})
