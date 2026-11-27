import type { DatasourceCredentialResponse } from '@dify/contracts/api/console/auth/types.gen'
import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import type { DataSourceNotionWorkspace } from '@/models/common'
import type { DataSourceNodeCompletedResponse, DataSourceNodeErrorResponse } from '@/types/pipeline'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VarKindType } from '@/app/components/workflow/nodes/_base/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { DatasourceType } from '@/models/pipeline'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { apiError } from '@/test/fake-api'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import { createDataSourceStore } from '../../store'
import { DataSourceContext } from '../../store/provider'
import OnlineDocuments from '../index'

const streamEvents = vi.hoisted(() => vi.fn<typeof import('@/service/event-stream').streamEvents>())
const runNode = vi.hoisted(() => vi.fn())
const getAuth = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-virtual')
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
  title: 'Notion',
  desc: '',
  provider_type: DatasourceType.onlineDocument,
  plugin_id: 'plugin-123',
  provider_name: 'notion',
  datasource_name: 'notion',
  datasource_label: 'Notion',
  datasource_parameters: { workspace: { type: VarKindType.constant, value: 'workspace-1' } },
  datasource_configurations: {},
}
const documents: DataSourceNotionWorkspace[] = [
  {
    workspace_name: 'Workspace',
    workspace_id: 'workspace-1',
    workspace_icon: null,
    pages: [
      {
        page_id: 'report',
        page_name: 'Report',
        parent_id: 'root',
        type: 'page',
        page_icon: null,
        is_bound: false,
      },
      {
        page_id: 'notes',
        page_name: 'Notes',
        parent_id: 'root',
        type: 'page',
        page_icon: null,
        is_bound: false,
      },
    ],
  },
]
const credentials: DatasourceCredentialResponse[] = [
  {
    id: 'credential-1',
    name: 'First credential',
    avatar_url: '',
    type: 'oauth2',
    is_default: false,
    credential: {},
  },
  {
    id: 'credential-2',
    name: 'Second credential',
    avatar_url: '',
    type: 'oauth2',
    is_default: false,
    credential: {},
  },
]
function setup({
  cached = true,
  credential = 'credential-1',
  single = false,
  draft = false,
  seedAuth = true,
} = {}) {
  const store = createDataSourceStore()
  store.setState({ documentsData: cached ? documents : undefined, currentCredentialId: credential })
  const queryClient = createConsoleQueryClient()
  if (seedAuth)
    queryClient.setQueryData(
      consoleQuery.auth.plugin.datasource.byProviderId.get.queryOptions({
        input: { params: { provider_id: 'plugin-123/notion' } },
      }).queryKey,
      { result: credential ? credentials : [] },
    )
  const onCredentialChange = vi.fn((id: string) => store.getState().setCurrentCredentialId(id))
  render(
    <DataSourceContext value={store}>
      <OnlineDocuments
        nodeId="node-1"
        nodeData={nodeData}
        onCredentialChange={onCredentialChange}
        supportBatchUpload={!single}
        isInPipeline={draft}
      />
    </DataSourceContext>,
    { queryClient },
  )
  return { store, onCredentialChange }
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
  'loads documents through the draft=%s route using resolved node parameters',
  async (draft) => {
    const { store } = setup({ cached: false, draft })
    await waitFor(() => expect(streamEvents).toHaveBeenCalledOnce())
    expect(lastRun()).toEqual([
      draft ? 'draft' : 'published',
      {
        params: { pipeline_id: 'pipeline-123', node_id: 'node-1' },
        body: {
          inputs: { workspace: 'workspace-1' },
          credential_id: 'credential-1',
          datasource_type: DatasourceType.onlineDocument,
        },
      },
    ])
    act(() =>
      callbacks().onDataSourceNodeCompleted({
        event: 'datasource_completed',
        time_consuming: 1,
        data: documents,
      }),
    )
    expect(await screen.findByRole('checkbox', { name: 'Report' })).toBeInTheDocument()
    expect(store.getState().documentsData).toEqual(documents)
    expect(screen.queryByTestId('notion-page-preview-report') !== null).toBe(!draft)
  },
)

it('waits for a credential before requesting documents', () => {
  setup({ cached: false, credential: '' })
  expect(streamEvents).not.toHaveBeenCalled()
})

it('selects pages with their workspace and removes only the deselected page', async () => {
  const user = userEvent.setup()
  const { store } = setup()
  await user.click(screen.getByRole('checkbox', { name: 'Report' }))
  await user.click(screen.getByRole('checkbox', { name: 'Notes' }))
  expect(store.getState().selectedPagesId).toEqual(new Set(['report', 'notes']))
  expect(store.getState().onlineDocuments).toEqual(
    documents[0]!.pages.map((page) => ({ ...page, workspace_id: 'workspace-1' })),
  )
  await user.click(screen.getByRole('checkbox', { name: 'Report' }))
  expect(store.getState().onlineDocuments).toEqual([
    { ...documents[0]!.pages[1], workspace_id: 'workspace-1' },
  ])
  expect(screen.getByRole('checkbox', { name: 'Notes' })).toBeChecked()
})

it('replaces the selected page in single-upload mode', async () => {
  const user = userEvent.setup()
  const { store } = setup({ single: true })
  await user.click(screen.getByRole('radio', { name: 'Report' }))
  await user.click(screen.getByRole('radio', { name: 'Notes' }))
  expect(store.getState().selectedPagesId).toEqual(new Set(['notes']))
  expect(store.getState().onlineDocuments).toEqual([
    { ...documents[0]!.pages[1], workspace_id: 'workspace-1' },
  ])
  expect(screen.getByRole('radio', { name: 'Report' })).not.toBeChecked()
})

it('filters documents without losing selection and previews the chosen page', async () => {
  const user = userEvent.setup()
  const { store } = setup()
  await user.click(screen.getByRole('checkbox', { name: 'Report' }))
  await user.type(
    screen.getByPlaceholderText('common.dataSource.notion.selector.searchPages'),
    'Notes',
  )
  await waitFor(() =>
    expect(screen.queryByRole('checkbox', { name: 'Report' })).not.toBeInTheDocument(),
  )
  await user.click(screen.getByTestId('notion-page-preview-notes'))
  expect(store.getState().currentDocument).toEqual({
    ...documents[0]!.pages[1],
    workspace_id: 'workspace-1',
  })
  expect(store.getState().selectedPagesId).toEqual(new Set(['report']))
  await user.click(screen.getByRole('button', { name: 'common.operation.clear' }))
  expect(await screen.findByRole('checkbox', { name: 'Report' })).toBeChecked()
})

it('requests documents again with the credential selected in the header', async () => {
  const user = userEvent.setup()
  const { onCredentialChange } = setup()
  await waitFor(() => expect(streamEvents).toHaveBeenCalledOnce())
  await user.click(screen.getByRole('button', { name: /First credential/ }))
  await user.click(await screen.findByText('Second credential'))
  expect(onCredentialChange).toHaveBeenCalledExactlyOnceWith('credential-2')
  await waitFor(() => expect(streamEvents).toHaveBeenCalledTimes(2))
  expect(lastRun()[1]).toMatchObject({ body: { credential_id: 'credential-2' } })
})

it('reports stream failures and opens data-source configuration', async () => {
  const user = userEvent.setup()
  setup({ cached: false })
  await waitFor(() => expect(streamEvents).toHaveBeenCalledOnce())
  act(() =>
    callbacks().onDataSourceNodeError({
      event: 'datasource_error',
      error: 'Notion request failed',
    }),
  )
  expect(toastError).toHaveBeenCalledExactlyOnceWith('Notion request failed')
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
