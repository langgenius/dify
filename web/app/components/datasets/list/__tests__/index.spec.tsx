import type { StepByStepTourSessionState } from '@/app/components/step-by-step-tour/types'
import type { consoleClient } from '@/service/console'
import type { ConsoleQueryTestOptions } from '@/test/console/query-data'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider as JotaiProvider } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import { stepByStepTourSessionAtom } from '@/app/components/step-by-step-tour/state'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { mockIntersectionObserver } from '@/test/intersection-observer'
import List from '../index'

const api = vi.hoisted(() => ({
  datasets: vi.fn<typeof consoleClient.datasets.get>(),
  push: vi.fn(),
}))
vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useRouter: () => ({ push: api.push }),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.get': api.datasets,
      'datasets.apiBaseInfo.get': async () => ({ api_base_url: 'https://api.example.test' }),
      'datasets.externalKnowledgeApi.get': async () => ({ data: [] }),
      'tags.get': async () => [{ id: 'tag-1', name: 'Research', type: 'knowledge' }],
    }),
  }
})

const datasetPage = (data = [createDatasetFixture()], page = 1, hasMore = false) => ({
  data,
  page,
  total: data.length,
  limit: 30,
  has_more: hasMore,
})

let intersect: ReturnType<typeof mockIntersectionObserver>

function setup(options: ConsoleQueryTestOptions = {}, tour?: StepByStepTourSessionState) {
  const queryClient = options.queryClient ?? createConsoleQueryClient()
  const store = createStore()
  store.set(queryClientAtom, queryClient)
  if (tour) store.set(stepByStepTourSessionAtom, tour)
  const rendered = renderWithConsoleQuery(
    <JotaiProvider store={store}>
      <List />
    </JotaiProvider>,
    {
      queryClient,
      currentWorkspace: { role: 'owner' },
      workspacePermissionKeys: [
        'dataset.create_and_management',
        'dataset.external.connect',
        'dataset.tag.manage',
      ],
      systemFeatures: { rbac_enabled: true },
      ...options,
    },
  )
  return { ...rendered, user: userEvent.setup() }
}

beforeEach(() => {
  api.datasets.mockReset().mockResolvedValue(datasetPage())
  api.push.mockReset()
  intersect = mockIntersectionObserver()
})
afterEach(() => vi.unstubAllGlobals())

it('renders real knowledge cards linking to their documents', async () => {
  setup()
  expect(await screen.findByRole('link', { name: 'Test Dataset' })).toHaveAttribute(
    'href',
    '/datasets/dataset-1/documents',
  )
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
})

it('offers creation from the first empty state only when permitted', async () => {
  api.datasets.mockResolvedValue(datasetPage([]))
  setup({ workspacePermissionKeys: ['dataset.create_and_management'] })
  expect(await screen.findByText('dataset.firstEmpty.title')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /dataset.firstEmpty.pipelineTitle/ })).toHaveAttribute(
    'href',
    '/datasets/create-from-pipeline',
  )
  expect(
    screen.queryByRole('button', { name: 'dataset.externalAPIPanelTitle' }),
  ).not.toBeInTheDocument()
})

it('shows a permission empty state without dataset creation access', async () => {
  api.datasets.mockResolvedValue(datasetPage([]))
  setup({ workspacePermissionKeys: [] })
  expect(await screen.findByText('dataset.firstEmpty.noCreatePermission')).toBeInTheDocument()
  expect(screen.queryByText('dataset.firstEmpty.title')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'common.operation.create' })).not.toBeInTheDocument()
})

it('uses the filtered empty state when an owner requests all knowledge', async () => {
  api.datasets.mockImplementation(async ({ query } = {}) =>
    datasetPage(query?.include_all ? [] : [createDatasetFixture()]),
  )
  const { user } = setup()
  await screen.findByRole('link', { name: 'Test Dataset' })
  await user.click(screen.getByRole('checkbox', { name: 'dataset.allKnowledge' }))
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent('dataset.filterEmpty.noKnowledge'),
  )
  expect(api.datasets).toHaveBeenLastCalledWith({
    query: expect.objectContaining({ include_all: true }),
  })
  expect(screen.queryByText('dataset.firstEmpty.title')).not.toBeInTheDocument()
})

it('does not expose the all-knowledge toggle to a non-owner', () => {
  setup({ currentWorkspace: { role: 'admin' } })
  expect(screen.queryByRole('checkbox', { name: 'dataset.allKnowledge' })).not.toBeInTheDocument()
})

it('keeps previous cards and delays the empty announcement until search settles', async () => {
  const pending = createDeferred<ReturnType<typeof datasetPage>>()
  api.datasets.mockResolvedValueOnce(datasetPage()).mockReturnValue(pending.promise)
  const { user } = setup()
  await screen.findByRole('link', { name: 'Test Dataset' })
  const search = screen.getByRole('searchbox')
  await user.type(search, 'missing')
  expect(screen.getByRole('status')).toBeEmptyDOMElement()
  await waitFor(() =>
    expect(api.datasets).toHaveBeenLastCalledWith({
      query: expect.objectContaining({ keyword: 'missing' }),
    }),
  )
  expect(screen.getByRole('link', { name: 'Test Dataset' })).toBeInTheDocument()
  expect(screen.getByRole('status')).toBeEmptyDOMElement()
  await act(async () => pending.resolve(datasetPage([])))
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent('dataset.filterEmpty.noKnowledge'),
  )
  expect(search).toHaveFocus()
  await user.type(search, ' again')
  expect(screen.getByRole('status')).toBeEmptyDOMElement()
})

it('filters by real tag IDs and restores the list after clearing tags', async () => {
  api.datasets.mockImplementation(async ({ query } = {}) =>
    datasetPage(query?.tag_ids?.length ? [] : [createDatasetFixture()]),
  )
  const { user } = setup()
  await screen.findByRole('link', { name: 'Test Dataset' })
  await user.click(screen.getByRole('combobox', { name: 'common.tag.placeholder' }))
  await user.click(await screen.findByRole('option', { name: 'Research' }))
  await user.keyboard('{Escape}')
  await waitFor(() =>
    expect(api.datasets).toHaveBeenLastCalledWith({
      query: expect.objectContaining({ tag_ids: ['tag-1'] }),
    }),
  )
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent('dataset.filterEmpty.noKnowledge'),
  )
  await user.click(screen.getByRole('button', { name: 'common.operation.clear' }))
  expect(await screen.findByRole('link', { name: 'Test Dataset' })).toBeInTheDocument()
})

it('opens real tag management from the filter and closes it', async () => {
  const { user } = setup()
  await user.click(screen.getByRole('combobox', { name: 'common.tag.placeholder' }))
  await user.click(screen.getByRole('button', { name: 'common.tag.manageTags' }))
  const dialog = await screen.findByRole('dialog', { name: 'common.tag.manageTags' })
  expect(within(dialog).getByRole('textbox', { name: 'common.tag.addNew' })).toBeInTheDocument()
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.close' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

it('opens and closes the external API panel through its actual controls', async () => {
  const { user } = setup()
  await user.click(screen.getByRole('button', { name: 'dataset.externalAPIPanelTitle' }))
  expect(
    await screen.findByRole('button', { name: 'dataset.createExternalAPI' }),
  ).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
  expect(
    screen.queryByRole('button', { name: 'dataset.createExternalAPI' }),
  ).not.toBeInTheDocument()
})

it('shows loading until the first page arrives without flashing the first empty state', async () => {
  const pending = createDeferred<ReturnType<typeof datasetPage>>()
  api.datasets.mockReturnValue(pending.promise)
  setup()
  expect(screen.getByRole('status', { name: 'common.loading' })).toBeInTheDocument()
  expect(screen.queryByText('dataset.firstEmpty.title')).not.toBeInTheDocument()
  await act(async () => pending.resolve(datasetPage([])))
  expect(await screen.findByText('dataset.firstEmpty.title')).toBeInTheDocument()
  expect(screen.queryByRole('status', { name: 'common.loading' })).not.toBeInTheDocument()
})

it('appends the next page once, retaining existing cards while it loads', async () => {
  const pending = createDeferred<ReturnType<typeof datasetPage>>()
  api.datasets
    .mockResolvedValueOnce(datasetPage(undefined, 1, true))
    .mockReturnValue(pending.promise)
  setup()
  await screen.findByRole('link', { name: 'Test Dataset' })
  intersect(false)
  expect(api.datasets).toHaveBeenCalledTimes(1)
  intersect()
  await waitFor(() =>
    expect(api.datasets).toHaveBeenCalledWith({ query: expect.objectContaining({ page: 2 }) }),
  )
  expect(screen.getByRole('link', { name: 'Test Dataset' })).toBeInTheDocument()
  intersect()
  expect(api.datasets).toHaveBeenCalledTimes(2)
  await act(async () =>
    pending.resolve(
      datasetPage([createDatasetFixture({ id: 'dataset-2', name: 'Next Dataset' })], 2),
    ),
  )
  expect(await screen.findByRole('link', { name: 'Next Dataset' })).toHaveAttribute(
    'href',
    '/datasets/dataset-2/documents',
  )
  expect(screen.getByRole('link', { name: 'Test Dataset' })).toBeInTheDocument()
  intersect()
  expect(api.datasets).toHaveBeenCalledTimes(2)
})

it('does not paginate stale results while changed filters are pending', async () => {
  const pending = createDeferred<ReturnType<typeof datasetPage>>()
  api.datasets
    .mockResolvedValueOnce(datasetPage(undefined, 1, true))
    .mockReturnValue(pending.promise)
  const { user } = setup()
  await screen.findByRole('link', { name: 'Test Dataset' })
  await user.type(screen.getByRole('searchbox'), 'filtered')
  await waitFor(() =>
    expect(api.datasets).toHaveBeenCalledWith({
      query: expect.objectContaining({ page: 1, keyword: 'filtered' }),
    }),
  )
  intersect()
  expect(api.datasets).toHaveBeenCalledTimes(2)
  expect(api.datasets).not.toHaveBeenCalledWith({ query: expect.objectContaining({ page: 2 }) })
  await act(async () => pending.resolve(datasetPage([])))
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent('dataset.filterEmpty.noKnowledge'),
  )
})

it.each([
  ['dataset.firstEmpty.createTitle', '/datasets/create'],
  ['dataset.firstEmpty.pipelineTitle', '/datasets/create-from-pipeline'],
  ['dataset.connectDataset', '/datasets/connect'],
])('opens the %s creation route from the header', async (label, path) => {
  const { user } = setup()
  await user.click(screen.getByRole('button', { name: 'common.operation.create' }))
  await user.click(screen.getByRole('menuitem', { name: label }))
  expect(api.push).toHaveBeenCalledExactlyOnceWith(path)
})

it('offers only external connection when the workspace cannot create internal datasets', async () => {
  api.datasets.mockResolvedValue(datasetPage([]))
  const { user } = setup({ workspacePermissionKeys: ['dataset.external.connect'] })
  expect(await screen.findByRole('link', { name: /dataset.connectDataset/ })).toHaveAttribute(
    'href',
    '/datasets/connect',
  )
  expect(
    screen.queryByRole('link', { name: /dataset.firstEmpty.createTitle/ }),
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'common.operation.create' }))
  expect(screen.getAllByRole('menuitem')).toHaveLength(1)
  await user.click(screen.getByRole('menuitem', { name: 'dataset.connectDataset' }))
  expect(api.push).toHaveBeenCalledExactlyOnceWith('/datasets/connect')
})

it('opens the creation walkthrough as presentation without letting it navigate', async () => {
  setup({}, { activeTaskId: 'knowledge', activeGuideIndex: 0 })
  const menu = await screen.findByRole('menu', { hidden: true })
  expect(menu).toHaveAttribute('aria-hidden', 'true')
  // The tour deliberately exposes a non-interactive menu; even direct events must not navigate.
  fireEvent.click(
    within(menu).getByRole('menuitem', { name: 'dataset.firstEmpty.createTitle', hidden: true }),
  )
  expect(api.push).not.toHaveBeenCalled()
})

it('opens only the first real card menu for the knowledge management walkthrough', async () => {
  api.datasets.mockResolvedValue(
    datasetPage([
      createDatasetFixture({ id: 'first', name: 'First', permission_keys: ['dataset.acl.edit'] }),
      createDatasetFixture({ id: 'second', name: 'Second', permission_keys: ['dataset.acl.edit'] }),
    ]),
  )
  setup(
    {},
    { activeTaskId: 'knowledge', activeGuideIndex: 1, activeGuideGroup: 'knowledgeWithDatasets' },
  )
  await screen.findByRole('link', { name: 'First' })
  await waitFor(() =>
    expect(
      screen
        .getAllByRole('button', { name: 'Dataset operations' })
        .map((button) => button.getAttribute('aria-expanded')),
    ).toEqual(['true', 'false']),
  )
  expect(screen.getAllByRole('menu', { hidden: true })).toHaveLength(1)
  expect(screen.getByRole('menu', { hidden: true })).toHaveAttribute('aria-hidden', 'true')
})
