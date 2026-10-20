import type { DatasourceCredentialResponse } from '@dify/contracts/api/console/auth/types.gen'
import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import type { CrawlResultItem } from '@/models/datasets'
import type {
  DataSourceNodeCompletedResponse,
  DataSourceNodeErrorResponse,
  DataSourceNodeProcessingResponse,
} from '@/types/pipeline'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum } from '@/app/components/workflow/types'
import { CrawlStep } from '@/models/datasets'
import { DatasourceType } from '@/models/pipeline'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import { createPipelineVariable } from '@/test/pipeline-variables'
import { createDataSourceStore } from '../../store'
import { DataSourceContext } from '../../store/provider'
import WebsiteCrawl from '../index'

const { ssePost, parameters } = vi.hoisted(() => ({ ssePost: vi.fn(), parameters: vi.fn() }))
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  ssePost,
}))
vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (
    select: (state: { dataset: { pipeline_id: string } }) => unknown,
  ) => select({ dataset: { pipeline_id: 'pipeline-123' } }),
}))
const onUrlUpdate = vi.fn()
const render = createNuqsTestRenderer(renderWithConsoleQuery, () => ({ onUrlUpdate }))
const nodeData: DataSourceNodeType = {
  type: BlockEnum.DataSource,
  title: 'Crawler',
  desc: '',
  provider_type: DatasourceType.websiteCrawl,
  plugin_id: 'plugin-123',
  provider_name: 'crawler',
  datasource_name: 'crawler',
  datasource_label: 'Crawler',
  datasource_parameters: {},
  datasource_configurations: {},
}
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
const pages: CrawlResultItem[] = [
  {
    title: 'First page',
    source_url: 'https://example.com/1',
    markdown: '# First',
    description: 'First',
  },
  {
    title: 'Second page',
    source_url: 'https://example.com/2',
    markdown: '# Second',
    description: 'Second',
  },
]
function setup({
  credential = 'credential-1',
  single = false,
  draft = false,
  loading = false,
} = {}) {
  parameters.mockImplementation(() =>
    loading
      ? new Promise(() => {})
      : Promise.resolve({
          variables: [
            createPipelineVariable({
              variable: 'url',
              label: 'URL',
              default_value: 'https://example.com',
            }),
          ],
        }),
  )
  const store = createDataSourceStore()
  store.setState({ currentCredentialId: credential })
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(
    consoleQuery.auth.plugin.datasource.byProviderId.get.queryOptions({
      input: { params: { provider_id: 'plugin-123/crawler' } },
    }).queryKey,
    { result: credential ? credentials : [] },
  )
  const workflows = consoleQuery.rag.pipelines.byPipelineId.workflows
  const options = (
    draft ? workflows.draft : workflows.published
  ).preProcessing.parameters.get.queryOptions({
    input: { params: { pipeline_id: 'pipeline-123' }, query: { node_id: 'node-1' } },
  })
  if (loading)
    queryClient.setQueryDefaults(options.queryKey, { queryFn: () => new Promise(() => {}) })
  else
    queryClient.setQueryData(options.queryKey, {
      variables: [
        createPipelineVariable({
          variable: 'url',
          label: 'URL',
          default_value: 'https://example.com',
        }),
      ],
    })
  const onCredentialChange = vi.fn((id: string) => {
    store.setState({
      currentCredentialId: id,
      step: CrawlStep.init,
      websitePages: [],
      crawlResult: undefined,
    })
  })
  render(
    <DataSourceContext value={store}>
      <WebsiteCrawl
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
  onDataSourceNodeProcessing: (data: DataSourceNodeProcessingResponse) => void
  onDataSourceNodeCompleted: (data: DataSourceNodeCompletedResponse) => void
  onDataSourceNodeError: (data: DataSourceNodeErrorResponse) => void
} {
  return ssePost.mock.lastCall![2]
}
const runButton = () => screen.getByRole('button', { name: 'datasetCreation.stepOne.website.run' })
function complete() {
  act(() =>
    callbacks().onDataSourceNodeCompleted({
      event: 'datasource_completed',
      time_consuming: 2.5,
      data: pages,
    }),
  )
}
beforeEach(() => vi.clearAllMocks())

it.each([true, false])(
  'runs the draft=%s workflow, displays streamed progress and selects completed pages',
  async (draft) => {
    const user = userEvent.setup()
    const { store } = setup({ draft })
    await waitFor(() => expect(runButton()).toBeEnabled())
    const input = screen.getByRole('textbox', { name: /URL/ })
    await user.clear(input)
    await user.type(input, 'https://example.com/docs')
    await waitFor(() => expect(runButton()).toBeEnabled())
    await user.click(runButton())
    await waitFor(() =>
      expect(ssePost).toHaveBeenCalledExactlyOnceWith(
        `/rag/pipelines/pipeline-123/workflows/${draft ? 'draft' : 'published'}/datasource/nodes/node-1/run`,
        {
          body: {
            inputs: { url: 'https://example.com/docs' },
            credential_id: 'credential-1',
            datasource_type: DatasourceType.websiteCrawl,
            response_mode: 'streaming',
          },
        },
        expect.any(Object),
      ),
    )
    act(() =>
      callbacks().onDataSourceNodeProcessing({
        event: 'datasource_processing',
        total: 2,
        completed: 1,
      }),
    )
    expect(screen.getByText(/totalPageScraped/)).toHaveTextContent('1/2')
    await user.click(
      screen.getByRole('button', { name: 'datasetCreation.stepOne.website.running' }),
    )
    expect(ssePost).toHaveBeenCalledOnce()
    complete()
    expect(store.getState().step).toBe(CrawlStep.finished)
    expect(store.getState().websitePages).toEqual(pages)
    expect(screen.getByRole('checkbox', { name: /First page/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Second page/ })).toBeChecked()
    expect(
      screen.queryAllByRole('button', { name: 'datasetCreation.stepOne.website.preview' }),
    ).toHaveLength(draft ? 0 : 2)
  },
)

it.each([{ credential: '' }, { loading: true }])(
  'prevents crawling when credentials or parameters are unavailable: %j',
  async (options) => {
    const user = userEvent.setup()
    setup(options)
    expect(runButton()).toBeDisabled()
    await user.click(runButton())
    expect(ssePost).not.toHaveBeenCalled()
  },
)

it('keeps only one page selected in single-upload mode', async () => {
  const user = userEvent.setup()
  const { store } = setup({ single: true })
  await waitFor(() => expect(runButton()).toBeEnabled())
  await user.click(runButton())
  await waitFor(() => expect(ssePost).toHaveBeenCalledOnce())
  complete()
  expect(store.getState().websitePages).toEqual([pages[0]])
  await user.click(screen.getByRole('radio', { name: /Second page/ }))
  expect(store.getState().websitePages).toEqual([pages[1]])
  expect(screen.getByRole('radio', { name: /First page/ })).not.toBeChecked()
})

it('deselects a page and previews it without changing the remaining selection', async () => {
  const user = userEvent.setup()
  const { store } = setup()
  await waitFor(() => expect(runButton()).toBeEnabled())
  await user.click(runButton())
  await waitFor(() => expect(ssePost).toHaveBeenCalledOnce())
  complete()
  await user.click(screen.getByRole('checkbox', { name: /Second page/ }))
  await user.click(
    screen.getAllByRole('button', { name: 'datasetCreation.stepOne.website.preview' })[1]!,
  )
  expect(store.getState().websitePages).toEqual([pages[0]])
  expect(store.getState().currentWebsite).toEqual(pages[1])
  expect(store.getState().previewIndex).toBe(1)
})

it.each(['Crawler unavailable', ''])(
  'shows a stream error and clears it after a successful retry: %s',
  async (message) => {
    const user = userEvent.setup()
    const { store } = setup()
    await waitFor(() => expect(runButton()).toBeEnabled())
    await user.click(runButton())
    await waitFor(() => expect(ssePost).toHaveBeenCalledOnce())
    act(() => callbacks().onDataSourceNodeError({ event: 'datasource_error', error: message }))
    const error = message || 'datasetCreation.stepOne.website.unknownError'
    expect(screen.getByText(error)).toBeInTheDocument()
    expect(store.getState().websitePages).toEqual([])
    await waitFor(() => expect(runButton()).toBeEnabled())
    await user.click(runButton())
    await waitFor(() => expect(ssePost).toHaveBeenCalledTimes(2))
    complete()
    expect(screen.queryByText(error)).not.toBeInTheDocument()
    expect(store.getState().websitePages).toEqual(pages)
  },
)

it('uses the changed credential on the next run and opens configuration', async () => {
  const user = userEvent.setup()
  const { onCredentialChange } = setup()
  await waitFor(() => expect(runButton()).toBeEnabled())
  await user.click(runButton())
  await waitFor(() => expect(ssePost).toHaveBeenCalledOnce())
  act(() =>
    callbacks().onDataSourceNodeError({
      event: 'datasource_error',
      error: 'Old credential failed',
    }),
  )
  await user.click(screen.getByRole('button', { name: /First credential/ }))
  await user.click(screen.getByText('Second credential'))
  expect(onCredentialChange).toHaveBeenCalledExactlyOnceWith('credential-2')
  await waitFor(() => expect(runButton()).toBeEnabled())
  await user.click(runButton())
  await waitFor(() => expect(ssePost).toHaveBeenCalledTimes(2))
  expect(ssePost.mock.lastCall![1].body.credential_id).toBe('credential-2')
  expect(screen.queryByText('Old credential failed')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /^datasetPipeline\.configurationTip/ }))
  await waitFor(() =>
    expect(onUrlUpdate.mock.lastCall![0].searchParams.get('settings')).toBe('data-source'),
  )
})

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'rag.pipelines.byPipelineId.workflows.published.preProcessing.parameters.get': parameters,
      'rag.pipelines.byPipelineId.workflows.draft.preProcessing.parameters.get': parameters,
    }),
  }
})
