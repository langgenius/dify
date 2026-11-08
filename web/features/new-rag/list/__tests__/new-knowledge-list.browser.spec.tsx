import type { KnowledgeFsUpgradeJobResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { consoleClient } from '@/service/console'
import type { ConsoleQueryTestOptions } from '@/test/console/query-data'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import { createHttpError } from '@/service/http-error'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { KnowledgeUpgradeProvider } from '../../upgrade/knowledge-upgrade-context'
import { NewKnowledgeList } from '../new-knowledge-list'

const api = vi.hoisted(() => ({
  spaces: vi.fn<typeof consoleClient.knowledgeFs.spaces.get>(),
  deleteSpace: vi.fn<typeof consoleClient.knowledgeFs.spaces.byControlSpaceId.delete>(),
  members: vi.fn<typeof consoleClient.workspaces.current.members.get>(),
  upgradeJobs: vi.fn<typeof consoleClient.datasets.knowledgeFsUpgradeJobs.get>(),
  upgradeJob: vi.fn<typeof consoleClient.datasets.byDatasetId.knowledgeFsUpgrades.byJobId.get>(),
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
      'knowledgeFs.spaces.get': api.spaces,
      'knowledgeFs.spaces.byControlSpaceId.delete': api.deleteSpace,
      'workspaces.current.members.get': api.members,
      'datasets.knowledgeFsUpgradeJobs.get': api.upgradeJobs,
      'datasets.get': api.datasets,
      'datasets.byDatasetId.knowledgeFsUpgrades.byJobId.get': api.upgradeJob,
      'datasets.apiBaseInfo.get': async () => ({ api_base_url: 'https://api.example.com' }),
      'datasets.externalKnowledgeApi.get': async () => ({
        data: [],
        has_more: false,
        limit: 100,
        page: 1,
        total: 0,
      }),
      'tags.get': async () => [
        { binding_count: '1', id: 'tag-1', name: 'Customer support', type: 'knowledge' },
        { binding_count: '1', id: 'tag-2', name: 'Public docs', type: 'knowledge' },
      ],
    }),
  }
})

type KnowledgeFsSpaceListResponse = Awaited<ReturnType<typeof consoleClient.knowledgeFs.spaces.get>>
type KnowledgeFsSpaceListItemResponse = KnowledgeFsSpaceListResponse['data'][number]
type DatasetListResponse = Awaited<ReturnType<typeof consoleClient.datasets.get>>

const space = (
  id: string,
  name: string,
  overrides: Partial<KnowledgeFsSpaceListItemResponse> = {},
): KnowledgeFsSpaceListItemResponse => ({
  control_space_id: id,
  created_at: '2026-07-15T00:00:00Z',
  knowledge_space_id: id,
  linked_apps: 0,
  owner_account_id: 'account-1',
  permission_keys: ['knowledge_space_read'],
  resource_version: 1,
  state: 'active',
  technical_status: 'available',
  technical_summary: {
    description: null,
    document_count: 0,
    icon: null,
    knowledge_space_id: id,
    name,
    revision: 1,
    slug: id,
  },
  updated_at: '2026-07-18T00:00:00Z',
  visibility: 'only_me',
  ...overrides,
})

const spacesPage = (
  data: KnowledgeFsSpaceListItemResponse[] = [],
  { page = 1, hasMore = false } = {},
): KnowledgeFsSpaceListResponse => ({ data, has_more: hasMore, limit: 30, page })

const job = (
  overrides: Partial<KnowledgeFsUpgradeJobResponse> = {},
): KnowledgeFsUpgradeJobResponse => ({
  completed_documents: 4,
  completed_sources: 1,
  id: 'upgrade-1',
  old_dataset_id: 'dataset-1',
  snapshot_at: '2026-08-18T00:00:00Z',
  stage: 'submitting_documents',
  status: 'running',
  total_documents: 10,
  total_sources: 1,
  ...overrides,
})

const legacyDataset = (
  latestJob: KnowledgeFsUpgradeJobResponse,
  discovery: { can_retry?: boolean; can_upgrade?: boolean } = {},
) => ({
  ...createDatasetFixture({ id: latestJob.old_dataset_id, name: 'Support knowledge' }),
  knowledge_fs_upgrade: {
    can_retry: false,
    can_upgrade: false,
    ...discovery,
    job: latestJob,
  },
})

const datasetsPage = (data: DatasetListResponse['data']): DatasetListResponse => ({
  data,
  has_more: false,
  limit: 50,
  page: 1,
  total: data.length,
})

const members = [
  { id: 'account-1', name: 'Alice', status: 'active' },
  { id: 'account-2', name: 'Bob', status: 'active' },
  { id: 'account-pending', name: 'Pending member', status: 'pending' },
].map((member) => ({
  ...member,
  avatar_url: null,
  email: `${member.id}@example.test`,
  role: 'normal' as const,
}))

const knowledgeList = () => page.getByRole('list', { name: 'dataset.knowledge' })
const upgradeCards = (name: string) =>
  knowledgeList().getByRole('listitem').filter({ hasText: name })
const search = () => page.getByRole('searchbox', { name: 'common.operation.search' })
const recoveryKeys = () => [
  consoleQuery.knowledgeFs.spaces.get.key(),
  consoleQuery.datasets.knowledgeFsUpgradeJobs.get.key(),
  consoleQuery.datasets.get.key(),
]
const lastSpacesQuery = () => api.spaces.mock.calls.at(-1)?.[0]?.query

async function setup({
  searchParams = '',
  ...options
}: ConsoleQueryTestOptions & { searchParams?: string } = {}) {
  const { wrapper: UrlState, onUrlUpdate } = createNuqsTestWrapper({
    searchParams,
    hasMemory: true,
  })
  const { queryClient, wrapper: QueryProvider } = createConsoleQueryWrapper({
    accountProfile: { id: 'account-1' },
    features: { enable_knowledge_fs: true },
    knowledgeFsFeatures: { upload_enabled: true },
    workspacePermissionKeys: ['dataset.create_and_management', 'dataset.external.connect'],
    ...options,
  })
  const rendered = await render(
    <QueryProvider>
      <UrlState>
        <KnowledgeUpgradeProvider onUpgradeStarted={() => {}}>
          <NewKnowledgeList />
        </KnowledgeUpgradeProvider>
      </UrlState>
    </QueryProvider>,
  )
  const refresh = (...queryKeys: readonly unknown[][]) =>
    Promise.all(queryKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey })))
  return { ...rendered, queryClient, onUrlUpdate, refresh }
}

const lastSearchParams = (onUrlUpdate: Awaited<ReturnType<typeof setup>>['onUrlUpdate']) =>
  onUrlUpdate.mock.calls.at(-1)?.[0].searchParams

describe('NewKnowledgeList', () => {
  beforeEach(async () => {
    await page.viewport(1000, 760)
    onTestFinished(guardUnexpectedFetch())
    api.spaces.mockResolvedValue(spacesPage())
    api.deleteSpace.mockResolvedValue({ result: 'success' })
    api.members.mockResolvedValue({ accounts: members })
    api.upgradeJobs.mockResolvedValue({ data: [] })
    api.upgradeJob.mockImplementation(() => new Promise(() => {}))
    api.datasets.mockResolvedValue(datasetsPage([]))
  })

  describe('collection', () => {
    it('shows a loading state until the first page resolves', async () => {
      api.spaces.mockReturnValue(new Promise(() => {}))
      await setup()

      await expect.element(page.getByRole('status', { name: 'common.loading' })).toBeInTheDocument()
    })

    it('links each knowledge space card to its detail shell with summary details', async () => {
      api.spaces.mockResolvedValue(
        spacesPage([
          space('space-1', 'Support knowledge', {
            linked_apps: 3,
            tags: [
              { id: 'tag-1', name: 'Customer support', type: 'knowledge' },
              { id: 'tag-2', name: 'Public docs', type: 'knowledge' },
            ],
            technical_summary: {
              description: 'Answers for customer support',
              document_count: 12,
              icon: 'builtin:camera',
              knowledge_space_id: 'space-1',
              name: 'Support knowledge',
              revision: 1,
              slug: 'support-knowledge',
            },
          }),
          space('space-2', 'Engineering handbook'),
        ]),
      )
      await setup()

      const support = page.getByRole('link', { name: 'Support knowledge' })
      const supportItem = knowledgeList().getByRole('listitem').filter({ has: support })
      await expect.element(support).toHaveAttribute('href', '/datasets/new/space-1')
      await expect
        .element(support)
        .toHaveAccessibleDescription(
          'Answers for customer support knowledgeOverview.overview.linkedApps: 3',
        )
      await expect
        .element(supportItem.getByText('Answers for customer support'))
        .toBeInTheDocument()
      await expect.element(supportItem.getByText('12')).toBeInTheDocument()
      await expect
        .element(
          supportItem.getByRole('combobox', {
            name: 'Customer support, Public docs: Support knowledge',
          }),
        )
        .toBeDisabled()
      await expect
        .element(page.getByRole('link', { name: 'Engineering handbook' }))
        .toHaveAttribute('href', '/datasets/new/space-2')
      await expect
        .element(knowledgeList().getByText('knowledgeSpace.noDescription'))
        .toBeInTheDocument()
      expect(api.spaces).toHaveBeenCalledWith({ query: { limit: 30, page: 1 } })
    })

    it('loads the next server page while search is active', async () => {
      const user = userEvent
      api.spaces.mockImplementation(async (input) =>
        input?.query?.page === 1
          ? spacesPage([space('space-1', 'Support knowledge')], { hasMore: true })
          : spacesPage([space('space-2', 'Support handbook')], { page: 2 }),
      )
      await setup()

      await search().fill('support')
      await vi.waitFor(() =>
        expect(lastSpacesQuery()).toEqual({ limit: 30, page: 1, query: 'support' }),
      )
      await user.click(page.getByRole('button', { name: 'knowledgeSpace.loadMore' }))

      await expect.element(page.getByRole('link', { name: 'Support handbook' })).toBeInTheDocument()
      await expect.element(page.getByRole('link', { name: 'Support knowledge' })).toBeVisible()
      expect(lastSpacesQuery()).toEqual({ limit: 30, page: 2, query: 'support' })
      await expect
        .element(page.getByRole('button', { name: 'knowledgeSpace.loadMore' }))
        .not.toBeInTheDocument()
    })

    it('retries a failed next page from one inline action', async () => {
      const user = userEvent
      api.spaces
        .mockResolvedValueOnce(
          spacesPage([space('space-1', 'Support knowledge')], { hasMore: true }),
        )
        .mockRejectedValueOnce(new Error('request failed'))
        .mockResolvedValueOnce(spacesPage([space('space-2', 'Engineering handbook')], { page: 2 }))
      await setup()

      await user.click(page.getByRole('button', { name: 'knowledgeSpace.loadMore' }))
      const alert = page.getByRole('alert')
      await user.click(alert.getByRole('button', { name: 'common.operation.retry' }))

      await expect
        .element(page.getByRole('link', { name: 'Engineering handbook' }))
        .toBeInTheDocument()
    })

    it.each([404, 503])(
      'shows an unavailable state without retry for a %s response',
      async (status) => {
        api.spaces.mockRejectedValue(createHttpError(new Response(null, { status })))
        await setup()

        await expect.element(page.getByText('knowledgeSpace.unavailableTitle')).toBeInTheDocument()
        await expect
          .element(page.getByRole('button', { name: 'common.operation.retry' }))
          .not.toBeInTheDocument()
      },
    )

    it('retries other collection failures', async () => {
      const user = userEvent
      api.spaces
        .mockRejectedValueOnce(new Error('request failed'))
        .mockResolvedValueOnce(spacesPage([space('space-1', 'Support knowledge')]))
      await setup()

      await expect.element(page.getByText('knowledgeSpace.errorTitle')).toBeInTheDocument()
      await user.click(page.getByRole('button', { name: 'common.operation.retry' }))

      await expect
        .element(page.getByRole('link', { name: 'Support knowledge' }))
        .toBeInTheDocument()
    })
  })

  describe('card actions', () => {
    it('keeps card actions outside the link and opens edit settings', async () => {
      const user = userEvent
      api.spaces.mockResolvedValue(
        spacesPage([
          space('space-1', 'Support knowledge', {
            permission_keys: [
              'knowledge_space_delete',
              'knowledge_space_edit',
              'knowledge_space_read',
            ],
          }),
        ]),
      )
      await setup()

      const cardLink = page.getByRole('link', { name: 'Support knowledge' })
      const actions = page.getByRole('button', { name: 'common.operation.more' })
      await expect.element(cardLink.getByRole('button')).not.toBeInTheDocument()

      await user.click(actions)

      await expect
        .element(page.getByRole('menuitem', { name: 'common.operation.edit' }))
        .toHaveAttribute('href', '/datasets/new/space-1/settings')
    })

    it('deletes after the exact name is confirmed and refreshes the collection', async () => {
      const user = userEvent
      api.spaces
        .mockResolvedValueOnce(
          spacesPage([
            space('space-1', 'Support knowledge', {
              permission_keys: ['knowledge_space_delete', 'knowledge_space_read'],
            }),
          ]),
        )
        .mockResolvedValue(spacesPage())
      await setup()

      await user.click(page.getByRole('button', { name: 'common.operation.more' }))
      await user.click(page.getByRole('menuitem', { name: 'common.operation.delete' }))
      const dialog = page.getByRole('alertdialog')
      const confirmation = dialog.getByRole('textbox')
      await expect.element(confirmation).toHaveFocus()
      const deleteButton = dialog.getByRole('button', { name: 'common.operation.confirm' })

      await user.type(confirmation, 'Support')
      await expect.element(deleteButton).toBeDisabled()
      await user.type(confirmation, ' knowledge')
      await user.click(deleteButton)

      await expect.element(dialog).not.toBeInTheDocument()
      await expect
        .element(page.getByRole('link', { name: 'Support knowledge' }))
        .not.toBeInTheDocument()
      await expect.element(page.getByRole('region', { name: 'knowledgeSpace.new' })).toHaveFocus()
      expect(api.deleteSpace).toHaveBeenCalledWith({ params: { control_space_id: 'space-1' } })
    })

    it('keeps the confirmation open with the failure when deletion fails', async () => {
      const user = userEvent
      api.spaces.mockResolvedValue(
        spacesPage([
          space('space-1', 'Support knowledge', {
            permission_keys: ['knowledge_space_delete', 'knowledge_space_read'],
          }),
        ]),
      )
      api.deleteSpace.mockRejectedValueOnce(new Error('network down'))
      await setup()

      await user.click(page.getByRole('button', { name: 'common.operation.more' }))
      await user.click(page.getByRole('menuitem', { name: 'common.operation.delete' }))
      const dialog = page.getByRole('alertdialog')
      const confirmation = dialog.getByRole('textbox')
      await confirmation.fill('Support knowledge')
      await expect.element(confirmation).toHaveValue('Support knowledge')
      await user.keyboard('{Enter}')

      await expect.element(dialog.getByRole('alert')).toHaveTextContent('common.api.actionFailed')
      await expect.element(confirmation).toHaveValue('Support knowledge')
      await expect.element(dialog).toBeVisible()
    })
  })

  describe('filters', () => {
    it('syncs tag and search filters to the URL and collection request', async () => {
      const user = userEvent
      api.spaces.mockImplementation(async (input) =>
        spacesPage([
          input?.query?.query
            ? space('search-result', 'Customer support search')
            : input?.query?.tag_ids?.length
              ? space('tagged-result', 'Tagged support knowledge')
              : space('all-result', 'All knowledge'),
        ]),
      )
      const { onUrlUpdate } = await setup()
      await expect.element(page.getByRole('link', { name: 'All knowledge' })).toBeVisible()

      await user.click(page.getByRole('combobox', { name: 'common.tag.placeholder' }))
      await user.click(page.getByRole('option', { name: 'Customer support' }))
      await user.click(page.getByRole('option', { name: 'Public docs' }))
      await user.keyboard('{Escape}')

      await vi.waitFor(() =>
        expect(lastSearchParams(onUrlUpdate)?.get('tag_ids')).toBe('tag-1;tag-2'),
      )
      await vi.waitFor(() =>
        expect(lastSpacesQuery()).toEqual({ limit: 30, page: 1, tag_ids: ['tag-1', 'tag-2'] }),
      )

      await expect
        .element(page.getByRole('link', { name: 'Tagged support knowledge' }))
        .toBeVisible()
      await expect
        .element(page.getByRole('link', { name: 'All knowledge' }))
        .not.toBeInTheDocument()
      await user.click(page.getByRole('button', { name: 'common.operation.clear' }))
      await expect.element(page.getByRole('link', { name: 'All knowledge' })).toBeVisible()
      await vi.waitFor(() => expect(lastSearchParams(onUrlUpdate)?.has('tag_ids')).toBe(false))

      await search().fill('customer support')
      await vi.waitFor(() =>
        expect(lastSpacesQuery()).toEqual({ limit: 30, page: 1, query: 'customer support' }),
      )
      await expect
        .element(page.getByRole('link', { name: 'Customer support search' }))
        .toBeVisible()
      await expect
        .element(page.getByRole('link', { name: 'All knowledge' }))
        .not.toBeInTheDocument()
      expect(lastSearchParams(onUrlUpdate)?.get('query')).toBe('customer support')
    })

    it('restores filters from the URL into the collection request', async () => {
      await setup({ searchParams: '?tag_ids=tag-1%3Btag-2&creator_ids=account-2' })

      await vi.waitFor(() =>
        expect(api.spaces).toHaveBeenCalledWith({
          query: { creator_ids: ['account-2'], limit: 30, page: 1, tag_ids: ['tag-1', 'tag-2'] },
        }),
      )
      await expect
        .element(page.getByRole('combobox', { name: 'dataset.creatorFilter.creators: 1' }))
        .toBeInTheDocument()
    })

    it('shows the no-results state for a restored search and clears it', async () => {
      api.spaces.mockImplementation(async (input) =>
        input?.query?.query ? spacesPage() : spacesPage([space('space-1', 'Support knowledge')]),
      )
      const { onUrlUpdate } = await setup({ searchParams: '?query=no%20matching%20knowledge' })

      await expect.element(search()).toHaveValue('no matching knowledge')
      await expect
        .element(page.getByText('common.operation.noSearchResults:{"content":"dataset.knowledge"}'))
        .toBeInTheDocument()

      await page
        .getByRole('button', { name: 'common.operation.clear', exact: true })
        .filter({ hasText: 'common.operation.clear' })
        .click()

      await expect.element(search()).toHaveValue('')
      await expect.element(page.getByRole('link', { name: 'Support knowledge' })).toBeVisible()
      await vi.waitFor(() => expect(lastSearchParams(onUrlUpdate)?.has('query')).toBe(false))
    })

    it('filters by active creators and resets the filter', async () => {
      const user = userEvent
      const { onUrlUpdate } = await setup()

      await user.click(page.getByRole('combobox', { name: 'dataset.creatorFilter.creators' }))
      await user.click(page.getByRole('option', { name: /Alice/ }))
      await user.click(page.getByRole('option', { name: /Bob/ }))

      await expect
        .element(page.getByRole('option', { name: /Pending member/ }))
        .not.toBeInTheDocument()
      await vi.waitFor(() =>
        expect(lastSearchParams(onUrlUpdate)?.get('creator_ids')).toBe('account-1;account-2'),
      )
      await vi.waitFor(() =>
        expect(lastSpacesQuery()).toEqual({
          creator_ids: ['account-1', 'account-2'],
          limit: 30,
          page: 1,
        }),
      )

      await user.click(page.getByRole('button', { name: 'app.studio.filters.reset' }))

      await vi.waitFor(() => expect(lastSearchParams(onUrlUpdate)?.has('creator_ids')).toBe(false))
    })

    it('caps creator filters at the API contract limit', async () => {
      const user = userEvent
      const accounts = Array.from({ length: 101 }, (_, index) => ({
        ...members[0]!,
        id: `account-${index + 1}`,
        name: `Member ${index + 1}`,
      }))
      api.members.mockResolvedValue({ accounts })
      await setup({
        searchParams: `?creator_ids=${accounts.map((account) => account.id).join(';')}`,
      })

      await user.click(page.getByRole('combobox', { name: 'dataset.creatorFilter.creators: 100' }))

      const unselected = page.getByRole('option', { name: /Member 101/ })
      await expect.element(unselected).toHaveAttribute('aria-disabled', 'true')
      await expect
        .element(unselected)
        .toHaveAccessibleDescription('dataset.creatorFilter.maxCreators: 100')
      expect(lastSpacesQuery()?.creator_ids).toHaveLength(100)
    })

    it('retries a failed members request while keeping cached creators', async () => {
      const user = userEvent
      const { refresh } = await setup()
      await user.click(page.getByRole('combobox', { name: 'dataset.creatorFilter.creators' }))
      await expect.element(page.getByRole('option', { name: /Alice/ })).toBeVisible()

      api.members.mockRejectedValueOnce(new Error('request failed'))
      await refresh(consoleQuery.workspaces.current.members.get.key())

      await expect.element(page.getByRole('alert')).toMatchTextContent(/common\.error/)
      await expect.element(page.getByRole('option', { name: /Alice/ })).toBeInTheDocument()
      await user.click(page.getByRole('button', { name: 'common.operation.retry' }))
      await expect.element(page.getByRole('alert')).not.toBeInTheDocument()
    })
  })

  describe('empty workspace', () => {
    it('links available creation modes', async () => {
      await setup()

      const connectSource = page.getByRole('link', {
        name: 'knowledgeSpace.connectSource',
      })
      await expect
        .element(connectSource)
        .toHaveAttribute('href', '/datasets/new/create?start=source')
      await expect
        .element(connectSource)
        .toHaveAccessibleDescription(
          'knowledgeSpace.connectSourceDescription dataset.firstEmpty.recommended',
        )
      await expect
        .element(page.getByRole('link', { name: 'knowledgeSpace.uploadFiles' }))
        .toHaveAttribute('href', '/datasets/new/create?start=upload')
      await expect
        .element(page.getByRole('link', { name: 'knowledgeSpace.startEmpty' }))
        .toHaveAttribute('href', '/datasets/new/create?start=empty')
      await expect
        .element(page.getByRole('link', { name: 'common.operation.create' }))
        .toHaveAttribute('href', '/datasets/new/create')
    })

    it('keeps upload unavailable when KnowledgeFS upload is disabled', async () => {
      await setup({ knowledgeFsFeatures: { upload_enabled: false } })

      const uploadFiles = page.getByRole('button', { name: 'knowledgeSpace.uploadFiles' })
      await expect.element(uploadFiles).toBeDisabled()
      await expect
        .element(uploadFiles)
        .toHaveAccessibleDescription(
          'knowledgeSpace.uploadFilesDescription dataset.cornerLabel.unavailable',
        )
    })

    it.each([
      ['external-connect only', ['dataset.external.connect']],
      ['read-only', []],
    ])('hides creation entries from %s users', async (_, workspacePermissionKeys) => {
      await setup({ workspacePermissionKeys })

      await expect.element(page.getByText('knowledgeSpace.readOnlyEmpty')).toBeInTheDocument()
      await expect
        .element(page.getByRole('link', { name: 'common.operation.create' }))
        .not.toBeInTheDocument()
      await expect
        .element(page.getByRole('link', { name: 'knowledgeSpace.connectSource' }))
        .not.toBeInTheDocument()
    })
  })

  describe('upgrade recovery', () => {
    it('restores upgrade cards from exact legacy dataset lookups', async () => {
      const failed = job({ status: 'failed' })
      api.upgradeJobs.mockResolvedValue({ data: [failed] })
      api.datasets.mockResolvedValue(datasetsPage([legacyDataset(failed, { can_retry: true })]))
      await setup()

      const card = upgradeCards('Support knowledge')
      await expect.element(card).toBeVisible()
      await expect
        .element(card.getByRole('button', { name: 'common.operation.retry' }))
        .toBeInTheDocument()
      expect(api.datasets).toHaveBeenCalledWith({ query: { ids: ['dataset-1'] } })
    })

    it('batches legacy dataset lookups and bounds failed-job recovery', async () => {
      const jobs = [
        ...Array.from({ length: 51 }, (_, index) =>
          job({ id: `running-${index}`, old_dataset_id: `dataset-${index}` }),
        ),
        ...Array.from({ length: 101 }, (_, index) =>
          job({
            id: `failed-${index}`,
            old_dataset_id: `failed-dataset-${index}`,
            status: 'failed',
          }),
        ),
      ]
      api.upgradeJobs.mockResolvedValue({ data: jobs })
      await setup()

      await vi.waitFor(() => expect(api.datasets).toHaveBeenCalledTimes(4))
      const batches = api.datasets.mock.calls.map(([input]) => input?.query?.ids ?? [])
      expect(batches.every((ids) => ids.length <= 50)).toBe(true)
      expect(batches.flat()).toEqual(jobs.slice(0, 151).map((item) => item.old_dataset_id))
    })

    it('keeps the empty workspace loading while upgrade datasets are restored', async () => {
      api.upgradeJobs.mockResolvedValue({ data: [job()] })
      const datasets = createDeferred<DatasetListResponse>()
      api.datasets.mockReturnValue(datasets.promise)
      await setup()

      await vi.waitFor(() => expect(api.datasets).toHaveBeenCalled())
      await expect.element(page.getByRole('status', { name: 'common.loading' })).toBeInTheDocument()
      await expect.element(page.getByText('knowledgeSpace.emptyTitle')).not.toBeInTheDocument()
    })

    it('retries a failed upgrade recovery', async () => {
      const user = userEvent
      const running = job()
      api.upgradeJobs.mockResolvedValue({ data: [running] })
      api.datasets
        .mockRejectedValueOnce(new Error('request failed'))
        .mockResolvedValue(datasetsPage([legacyDataset(running)]))
      await setup()

      await expect
        .element(page.getByRole('heading', { name: 'knowledgeSpace.errorTitle' }))
        .toBeInTheDocument()
      await user.click(page.getByRole('button', { name: 'common.operation.retry' }))

      await expect.poll(() => upgradeCards('Support knowledge').elements().length).toBe(1)
    })

    it('keeps historical failures for one dataset distinct by job', async () => {
      const older = job({ id: 'upgrade-1', status: 'failed' })
      const newer = job({ id: 'upgrade-2', status: 'failed' })
      api.upgradeJobs.mockResolvedValue({ data: [older, newer] })
      api.datasets.mockResolvedValue(datasetsPage([legacyDataset(newer, { can_retry: true })]))
      await setup()

      await expect.poll(() => upgradeCards('Support knowledge').elements().length).toBe(2)
      expect(api.datasets).toHaveBeenCalledWith({ query: { ids: ['dataset-1'] } })
    })

    it('offers retry for an older failure after a newer migration succeeds', async () => {
      const failed = job({ id: 'upgrade-failed', status: 'failed' })
      api.upgradeJobs.mockResolvedValue({ data: [failed] })
      api.datasets.mockResolvedValue(
        datasetsPage([
          legacyDataset(
            job({
              id: 'upgrade-succeeded',
              new_control_space_id: 'space-1',
              stage: 'completed',
              status: 'succeeded',
            }),
            { can_upgrade: true },
          ),
        ]),
      )
      await setup()

      await expect
        .element(page.getByRole('button', { name: 'common.operation.retry' }))
        .toBeInTheDocument()
    })

    it('keeps server retry eligibility authoritative over a stale local upgrade', async () => {
      const running = job()
      const failed = job({ status: 'failed', last_error_message: 'The import failed' })
      api.upgradeJobs.mockResolvedValue({ data: [running] })
      api.datasets.mockResolvedValue(datasetsPage([legacyDataset(running)]))
      const detail = createDeferred<KnowledgeFsUpgradeJobResponse>()
      api.upgradeJob.mockReturnValue(detail.promise)
      const { refresh } = await setup()
      await expect.element(upgradeCards('Support knowledge')).toBeVisible()
      api.upgradeJobs.mockResolvedValue({ data: [failed] })
      api.datasets.mockResolvedValue(datasetsPage([legacyDataset(failed)]))
      detail.resolve(failed)
      await expect.element(page.getByText('The import failed')).toBeVisible()
      await refresh(...recoveryKeys())
      await expect.poll(() => upgradeCards('Support knowledge').elements().length).toBe(1)
      await expect
        .element(page.getByRole('button', { name: 'common.operation.retry' }))
        .not.toBeInTheDocument()
    })

    it('hides a knowledge space behind its active upgrade card', async () => {
      const running = job({ new_control_space_id: 'space-1' })
      api.spaces.mockResolvedValue(spacesPage([space('space-1', 'space-1')]))
      api.upgradeJobs.mockResolvedValue({ data: [running] })
      api.datasets.mockResolvedValue(datasetsPage([legacyDataset(running)]))
      await setup()

      await expect.poll(() => upgradeCards('Support knowledge').elements().length).toBe(1)
      await expect.element(page.getByRole('link', { name: 'space-1' })).not.toBeInTheDocument()
    })

    it('dismisses a completed local upgrade only after its space is visible and the job leaves recovery', async () => {
      const running = job()
      const succeeded = job({
        completed_documents: 10,
        new_control_space_id: 'space-1',
        stage: 'completed',
        status: 'succeeded',
      })
      api.upgradeJobs.mockResolvedValue({ data: [running] })
      api.datasets.mockResolvedValue(datasetsPage([legacyDataset(running)]))
      api.upgradeJob.mockResolvedValue(succeeded)
      const { refresh } = await setup()
      await expect
        .element(page.getByRole('link', { name: 'Support knowledge' }))
        .toHaveAttribute('href', '/datasets/new/space-1')

      api.upgradeJobs.mockResolvedValue({ data: [] })
      api.spaces.mockResolvedValue(spacesPage([space('space-2', 'Engineering handbook')]))
      await refresh(...recoveryKeys())
      // Wait for the new response to reach the DOM before checking retention of the old card.
      await expect.element(page.getByRole('link', { name: 'Engineering handbook' })).toBeVisible()
      await expect.element(page.getByRole('link', { name: 'Support knowledge' })).toBeVisible()
      api.upgradeJobs.mockResolvedValue({ data: [running] })
      api.spaces.mockResolvedValue(spacesPage([space('space-1', 'Upgraded knowledge')]))
      await refresh(...recoveryKeys())
      await expect.element(page.getByRole('link', { name: 'Upgraded knowledge' })).toBeVisible()
      // A temporarily missing space must still retain the locally completed card while recovery owns the job.
      api.spaces.mockResolvedValue(spacesPage())
      await refresh(consoleQuery.knowledgeFs.spaces.get.key())
      await expect.element(page.getByRole('link', { name: 'Support knowledge' })).toBeVisible()

      api.spaces.mockResolvedValue(spacesPage([space('space-1', 'Upgraded knowledge')]))
      api.upgradeJobs.mockResolvedValue({ data: [] })
      await refresh(...recoveryKeys())
      await expect.element(page.getByRole('link', { name: 'Upgraded knowledge' })).toBeVisible()
      // After successful handoff, a collection refresh must not resurrect a dismissed local card.
      api.spaces.mockResolvedValue(spacesPage())
      await refresh(consoleQuery.knowledgeFs.spaces.get.key())
      await expect.element(page.getByText('knowledgeSpace.emptyTitle')).toBeVisible()
      await expect
        .element(page.getByRole('link', { name: 'Support knowledge' }))
        .not.toBeInTheDocument()
    })
  })
})
