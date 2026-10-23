import type { KnowledgeFsUpgradeJobResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { ReactElement } from 'react'
import type { KnowledgeUpgrade } from '../../upgrade/knowledge-upgrade-context-value'
import type { consoleClient } from '@/service/console'
import type { ConsoleQueryTestOptions } from '@/test/console/query-data'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import { createHttpError } from '@/service/http-error'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import { KnowledgeUpgradeContext } from '../../upgrade/knowledge-upgrade-context-value'
import { NewKnowledgeList } from '../new-knowledge-list'

const api = vi.hoisted(() => ({
  spaces: vi.fn<typeof consoleClient.knowledgeFs.spaces.get>(),
  deleteSpace: vi.fn<typeof consoleClient.knowledgeFs.spaces.byControlSpaceId.delete>(),
  members: vi.fn<typeof consoleClient.workspaces.current.members.get>(),
  upgradeJobs: vi.fn<typeof consoleClient.datasets.knowledgeFsUpgradeJobs.get>(),
  datasets: vi.fn<typeof consoleClient.datasets.get>(),
  push: vi.fn(),
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}))

vi.mock('@/app/notifications', () => ({ toast: api.toast }))
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
      'datasets.byDatasetId.knowledgeFsUpgrades.byJobId.get': () => new Promise(() => {}),
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

const knowledgeList = () => screen.getByRole('list', { name: 'dataset.knowledge' })
const upgradeCards = (name: string) =>
  within(knowledgeList())
    .getAllByRole('listitem')
    .filter((item) => within(item).queryByText(name))
const search = () => screen.getByRole('searchbox', { name: 'common.operation.search' })
const recoveryKeys = () => [
  consoleQuery.knowledgeFs.spaces.get.key(),
  consoleQuery.datasets.knowledgeFsUpgradeJobs.get.key(),
  consoleQuery.datasets.get.key(),
]
const lastSpacesQuery = () => api.spaces.mock.calls.at(-1)?.[0]?.query

function setup({
  searchParams = '',
  upgrades = [],
  ...options
}: ConsoleQueryTestOptions & { searchParams?: string; upgrades?: KnowledgeUpgrade[] } = {}) {
  const { wrapper: UrlState, onUrlUpdate } = createNuqsTestWrapper({
    searchParams,
    hasMemory: true,
  })
  const dismissUpgrade = vi.fn()
  const ui = (): ReactElement => (
    <UrlState>
      <KnowledgeUpgradeContext
        value={{
          dismissUpgrade,
          enabled: true,
          requestUpgrade: vi.fn(),
          settleUpgrade: vi.fn(),
          upgrades,
        }}
      >
        <NewKnowledgeList view="agent" onViewChange={vi.fn()} />
      </KnowledgeUpgradeContext>
    </UrlState>
  )
  const rendered = renderWithConsoleQuery(ui(), {
    accountProfile: { id: 'account-1' },
    knowledgeFsFeatures: { enabled: true, upload_enabled: true },
    workspacePermissionKeys: ['dataset.create_and_management', 'dataset.external.connect'],
    ...options,
  })
  const refresh = (...queryKeys: readonly unknown[][]) =>
    act(() =>
      Promise.all(
        queryKeys.map((queryKey) => rendered.queryClient.invalidateQueries({ queryKey })),
      ).then(() => undefined),
    )
  return { ...rendered, dismissUpgrade, onUrlUpdate, refresh }
}

const lastSearchParams = (onUrlUpdate: ReturnType<typeof setup>['onUrlUpdate']) =>
  onUrlUpdate.mock.calls.at(-1)?.[0].searchParams

describe('NewKnowledgeList', () => {
  beforeEach(() => {
    api.spaces.mockResolvedValue(spacesPage())
    api.deleteSpace.mockResolvedValue({ result: 'success' })
    api.members.mockResolvedValue({ accounts: members })
    api.upgradeJobs.mockResolvedValue({ data: [] })
    api.datasets.mockResolvedValue(datasetsPage([]))
  })

  describe('collection', () => {
    it('shows a loading state until the first page resolves', () => {
      api.spaces.mockReturnValue(new Promise(() => {}))
      setup()

      expect(screen.getByRole('status', { name: 'common.loading' })).toBeInTheDocument()
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
      setup()

      const support = await screen.findByRole('link', { name: 'Support knowledge' })
      const supportItem = support.closest('li')!
      expect(support).toHaveAttribute('href', '/datasets/new/space-1')
      expect(support).toHaveAccessibleDescription(
        'Answers for customer support knowledgeOverview.overview.linkedApps: 3',
      )
      expect(within(support).getByTitle('camera')).toBeInTheDocument()
      expect(within(supportItem).getByText('Answers for customer support')).toBeInTheDocument()
      expect(within(supportItem).getByText('12')).toBeInTheDocument()
      expect(
        within(supportItem).getByRole('combobox', {
          name: 'Customer support, Public docs: Support knowledge',
        }),
      ).toBeDisabled()
      expect(screen.getByRole('link', { name: 'Engineering handbook' })).toHaveAttribute(
        'href',
        '/datasets/new/space-2',
      )
      expect(within(knowledgeList()).getByText('knowledgeSpace.noDescription')).toBeInTheDocument()
      expect(api.spaces).toHaveBeenCalledWith({ query: { limit: 30, page: 1 } })
    })

    it('loads the next server page while search is active', async () => {
      const user = userEvent.setup()
      api.spaces.mockImplementation(async (input) =>
        input?.query?.page === 1
          ? spacesPage([space('space-1', 'Support knowledge')], { hasMore: true })
          : spacesPage([space('space-2', 'Support handbook')], { page: 2 }),
      )
      setup()

      await user.type(search(), 'support')
      await waitFor(() =>
        expect(lastSpacesQuery()).toEqual({ limit: 30, page: 1, query: 'support' }),
      )
      await user.click(await screen.findByRole('button', { name: 'knowledgeSpace.loadMore' }))

      expect(await screen.findByRole('link', { name: 'Support handbook' })).toBeInTheDocument()
      expect(lastSpacesQuery()).toEqual({ limit: 30, page: 2, query: 'support' })
      expect(
        screen.queryByRole('button', { name: 'knowledgeSpace.loadMore' }),
      ).not.toBeInTheDocument()
    })

    it('retries a failed next page from one inline action', async () => {
      const user = userEvent.setup()
      api.spaces
        .mockResolvedValueOnce(
          spacesPage([space('space-1', 'Support knowledge')], { hasMore: true }),
        )
        .mockRejectedValueOnce(new Error('request failed'))
        .mockResolvedValueOnce(spacesPage([space('space-2', 'Engineering handbook')], { page: 2 }))
      setup()

      await user.click(await screen.findByRole('button', { name: 'knowledgeSpace.loadMore' }))
      const alert = await screen.findByRole('alert')
      await user.click(within(alert).getByRole('button', { name: 'common.operation.retry' }))

      expect(await screen.findByRole('link', { name: 'Engineering handbook' })).toBeInTheDocument()
    })

    it.each([404, 503])(
      'shows an unavailable state without retry for a %s response',
      async (status) => {
        api.spaces.mockRejectedValue(createHttpError(new Response(null, { status })))
        setup()

        expect(await screen.findByText('knowledgeSpace.unavailableTitle')).toBeInTheDocument()
        expect(
          screen.queryByRole('button', { name: 'common.operation.retry' }),
        ).not.toBeInTheDocument()
      },
    )

    it('retries other collection failures', async () => {
      const user = userEvent.setup()
      api.spaces
        .mockRejectedValueOnce(new Error('request failed'))
        .mockResolvedValueOnce(spacesPage([space('space-1', 'Support knowledge')]))
      setup()

      expect(await screen.findByText('knowledgeSpace.errorTitle')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))

      expect(await screen.findByRole('link', { name: 'Support knowledge' })).toBeInTheDocument()
    })
  })

  describe('card actions', () => {
    it('keeps card actions outside the link and opens edit settings', async () => {
      const user = userEvent.setup()
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
      setup()

      const cardLink = await screen.findByRole('link', { name: 'Support knowledge' })
      const actions = screen.getByRole('button', { name: 'common.operation.more' })
      expect(cardLink).not.toContainElement(actions)

      await user.click(actions)

      expect(screen.getByRole('menuitem', { name: 'common.operation.edit' })).toHaveAttribute(
        'href',
        '/datasets/new/space-1/settings',
      )
    })

    it('deletes after the exact name is confirmed and refreshes the collection', async () => {
      const user = userEvent.setup()
      api.spaces
        .mockResolvedValueOnce(
          spacesPage([
            space('space-1', 'Support knowledge', {
              permission_keys: ['knowledge_space_delete', 'knowledge_space_read'],
            }),
          ]),
        )
        .mockResolvedValue(spacesPage())
      setup()

      await user.click(await screen.findByRole('button', { name: 'common.operation.more' }))
      await user.click(screen.getByRole('menuitem', { name: 'common.operation.delete' }))
      const dialog = await screen.findByRole('alertdialog')
      const confirmation = within(dialog).getByRole('textbox')
      expect(confirmation).toHaveFocus()
      const deleteButton = within(dialog).getByRole('button', { name: 'common.operation.confirm' })

      await user.type(confirmation, 'Support')
      expect(deleteButton).toBeDisabled()
      await user.type(confirmation, ' knowledge')
      await user.click(deleteButton)

      await waitFor(() =>
        expect(screen.queryByRole('link', { name: 'Support knowledge' })).not.toBeInTheDocument(),
      )
      expect(api.deleteSpace).toHaveBeenCalledWith({ params: { control_space_id: 'space-1' } })
    })

    it('keeps the confirmation open with the failure when deletion fails', async () => {
      const user = userEvent.setup()
      api.spaces.mockResolvedValue(
        spacesPage([
          space('space-1', 'Support knowledge', {
            permission_keys: ['knowledge_space_delete', 'knowledge_space_read'],
          }),
        ]),
      )
      api.deleteSpace.mockRejectedValueOnce(new Error('network down'))
      setup()

      await user.click(await screen.findByRole('button', { name: 'common.operation.more' }))
      await user.click(screen.getByRole('menuitem', { name: 'common.operation.delete' }))
      const dialog = await screen.findByRole('alertdialog')
      const confirmation = within(dialog).getByRole('textbox')
      await user.type(confirmation, 'Support knowledge{Enter}')

      expect(await within(dialog).findByRole('alert')).toHaveTextContent('common.api.actionFailed')
      expect(confirmation).toHaveValue('Support knowledge')
      expect(
        screen.getByRole('link', { name: 'Support knowledge', hidden: true }),
      ).toBeInTheDocument()
    })
  })

  describe('filters', () => {
    it('syncs tag and search filters to the URL and collection request', async () => {
      const user = userEvent.setup()
      const { onUrlUpdate } = setup()

      await user.click(await screen.findByRole('combobox', { name: 'common.tag.placeholder' }))
      await user.click(await screen.findByRole('option', { name: 'Customer support' }))
      await user.click(screen.getByRole('option', { name: 'Public docs' }))
      await user.keyboard('{Escape}')

      await waitFor(() => expect(lastSearchParams(onUrlUpdate)?.get('tag_ids')).toBe('tag-1;tag-2'))
      await waitFor(() =>
        expect(lastSpacesQuery()).toEqual({ limit: 30, page: 1, tag_ids: ['tag-1', 'tag-2'] }),
      )

      await user.click(screen.getByRole('button', { name: 'common.operation.clear' }))
      await waitFor(() => expect(lastSearchParams(onUrlUpdate)?.has('tag_ids')).toBe(false))

      await user.type(search(), 'customer support')
      await waitFor(() =>
        expect(lastSpacesQuery()).toEqual({ limit: 30, page: 1, query: 'customer support' }),
      )
      expect(lastSearchParams(onUrlUpdate)?.get('query')).toBe('customer support')
    })

    it('restores filters from the URL into the collection request', async () => {
      setup({ searchParams: '?tag_ids=tag-1%3Btag-2&creator_ids=account-2' })

      await waitFor(() =>
        expect(api.spaces).toHaveBeenCalledWith({
          query: { creator_ids: ['account-2'], limit: 30, page: 1, tag_ids: ['tag-1', 'tag-2'] },
        }),
      )
      expect(
        screen.getByRole('combobox', { name: 'dataset.creatorFilter.creators: 1' }),
      ).toBeInTheDocument()
    })

    it('shows the no-results state for a restored search and clears it', async () => {
      const user = userEvent.setup()
      const { onUrlUpdate } = setup({ searchParams: '?query=no%20matching%20knowledge' })

      expect(search()).toHaveValue('no matching knowledge')
      expect(
        await screen.findByText('common.operation.noSearchResults:{"content":"dataset.knowledge"}'),
      ).toBeInTheDocument()

      await user.click(screen.getByText('common.operation.clear', { selector: 'button' }))

      expect(search()).toHaveValue('')
      await waitFor(() => expect(lastSearchParams(onUrlUpdate)?.has('query')).toBe(false))
    })

    it('filters by active creators and resets the filter', async () => {
      const user = userEvent.setup()
      const { onUrlUpdate } = setup()

      await user.click(screen.getByRole('combobox', { name: 'dataset.creatorFilter.creators' }))
      await user.click(await screen.findByRole('option', { name: /Alice/ }))
      await user.click(screen.getByRole('option', { name: /Bob/ }))

      expect(screen.queryByRole('option', { name: /Pending member/ })).not.toBeInTheDocument()
      await waitFor(() =>
        expect(lastSearchParams(onUrlUpdate)?.get('creator_ids')).toBe('account-1;account-2'),
      )
      await waitFor(() =>
        expect(lastSpacesQuery()).toEqual({
          creator_ids: ['account-1', 'account-2'],
          limit: 30,
          page: 1,
        }),
      )

      await user.click(screen.getByRole('button', { name: 'app.studio.filters.reset' }))

      await waitFor(() => expect(lastSearchParams(onUrlUpdate)?.has('creator_ids')).toBe(false))
    })

    it('caps creator filters at the API contract limit', async () => {
      const user = userEvent.setup()
      const accounts = Array.from({ length: 101 }, (_, index) => ({
        ...members[0]!,
        id: `account-${index + 1}`,
        name: `Member ${index + 1}`,
      }))
      api.members.mockResolvedValue({ accounts })
      setup({ searchParams: `?creator_ids=${accounts.map((account) => account.id).join(';')}` })

      await user.click(
        screen.getByRole('combobox', { name: 'dataset.creatorFilter.creators: 100' }),
      )

      const unselected = await screen.findByRole('option', { name: /Member 101/ })
      expect(unselected).toHaveAttribute('aria-disabled', 'true')
      expect(unselected).toHaveAccessibleDescription('dataset.creatorFilter.maxCreators: 100')
      expect(lastSpacesQuery()?.creator_ids).toHaveLength(100)
    })

    it('retries a failed members request while keeping cached creators', async () => {
      const user = userEvent.setup()
      const { refresh } = setup()
      await user.click(screen.getByRole('combobox', { name: 'dataset.creatorFilter.creators' }))
      await screen.findByRole('option', { name: /Alice/ })

      api.members.mockRejectedValueOnce(new Error('request failed'))
      await refresh(consoleQuery.workspaces.current.members.get.key())

      expect(await screen.findByRole('alert')).toHaveTextContent('common.error')
      expect(screen.getByRole('option', { name: /Alice/ })).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
      await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    })
  })

  describe('empty workspace', () => {
    it('links available creation modes', async () => {
      setup()

      const connectSource = await screen.findByRole('link', {
        name: 'knowledgeSpace.connectSource',
      })
      expect(connectSource).toHaveAttribute('href', '/datasets/new/create?start=source')
      expect(connectSource).toHaveAccessibleDescription(
        'knowledgeSpace.connectSourceDescription dataset.firstEmpty.recommended',
      )
      expect(screen.getByRole('link', { name: 'knowledgeSpace.uploadFiles' })).toHaveAttribute(
        'href',
        '/datasets/new/create?start=upload',
      )
      expect(screen.getByRole('link', { name: 'knowledgeSpace.startEmpty' })).toHaveAttribute(
        'href',
        '/datasets/new/create?start=empty',
      )
      expect(screen.getByRole('link', { name: 'common.operation.create' })).toHaveAttribute(
        'href',
        '/datasets/new/create',
      )
    })

    it('keeps upload unavailable when KnowledgeFS upload is disabled', async () => {
      setup({ knowledgeFsFeatures: { enabled: true, upload_enabled: false } })

      const uploadFiles = await screen.findByRole('button', { name: 'knowledgeSpace.uploadFiles' })
      expect(uploadFiles).toBeDisabled()
      expect(uploadFiles).toHaveAccessibleDescription(
        'knowledgeSpace.uploadFilesDescription dataset.cornerLabel.unavailable',
      )
    })

    it.each([
      ['external-connect only', ['dataset.external.connect'], true],
      ['read-only', [], false],
    ])('hides creation entries from %s users', async (_, workspacePermissionKeys, canConnect) => {
      setup({ workspacePermissionKeys })

      expect(await screen.findByText('knowledgeSpace.readOnlyEmpty')).toBeInTheDocument()
      expect(
        screen.queryByRole('link', { name: 'common.operation.create' }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('link', { name: 'knowledgeSpace.connectSource' }),
      ).not.toBeInTheDocument()
      expect(Boolean(screen.queryByRole('button', { name: 'dataset.externalAPIPanelTitle' }))).toBe(
        canConnect,
      )
    })
  })

  describe('upgrade recovery', () => {
    it('restores upgrade cards from exact legacy dataset lookups', async () => {
      const failed = job({ status: 'failed' })
      api.upgradeJobs.mockResolvedValue({ data: [failed] })
      api.datasets.mockResolvedValue(datasetsPage([legacyDataset(failed, { can_retry: true })]))
      setup()

      const [card] = await waitFor(() => {
        const cards = upgradeCards('Support knowledge')
        expect(cards).toHaveLength(1)
        return cards
      })
      expect(
        within(card!).getByRole('button', { name: 'common.operation.retry' }),
      ).toBeInTheDocument()
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
      setup()

      await waitFor(() => expect(api.datasets).toHaveBeenCalledTimes(4))
      const batches = api.datasets.mock.calls.map(([input]) => input?.query?.ids ?? [])
      expect(batches.every((ids) => ids.length <= 50)).toBe(true)
      expect(batches.flat()).toEqual(jobs.slice(0, 151).map((item) => item.old_dataset_id))
    })

    it('keeps the empty workspace loading while upgrade datasets are restored', async () => {
      api.upgradeJobs.mockResolvedValue({ data: [job()] })
      const datasets = createDeferred<DatasetListResponse>()
      api.datasets.mockReturnValue(datasets.promise)
      setup()

      await waitFor(() => expect(api.datasets).toHaveBeenCalled())
      expect(screen.getByRole('status', { name: 'common.loading' })).toBeInTheDocument()
      expect(screen.queryByText('knowledgeSpace.emptyTitle')).not.toBeInTheDocument()
    })

    it('retries a failed upgrade recovery', async () => {
      const user = userEvent.setup()
      const running = job()
      api.upgradeJobs.mockResolvedValue({ data: [running] })
      api.datasets
        .mockRejectedValueOnce(new Error('request failed'))
        .mockResolvedValue(datasetsPage([legacyDataset(running)]))
      setup()

      expect(
        await screen.findByRole('heading', { name: 'knowledgeSpace.errorTitle' }),
      ).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))

      await waitFor(() => expect(upgradeCards('Support knowledge')).toHaveLength(1))
    })

    it('keeps historical failures for one dataset distinct by job', async () => {
      const older = job({ id: 'upgrade-1', status: 'failed' })
      const newer = job({ id: 'upgrade-2', status: 'failed' })
      api.upgradeJobs.mockResolvedValue({ data: [older, newer] })
      api.datasets.mockResolvedValue(datasetsPage([legacyDataset(newer, { can_retry: true })]))
      setup()

      await waitFor(() => expect(upgradeCards('Support knowledge')).toHaveLength(2))
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
      setup()

      expect(
        await screen.findByRole('button', { name: 'common.operation.retry' }),
      ).toBeInTheDocument()
    })

    it('keeps server retry eligibility authoritative over a stale local upgrade', async () => {
      const failed = job({ status: 'failed' })
      const dataset = legacyDataset(failed)
      api.upgradeJobs.mockResolvedValue({ data: [failed] })
      api.datasets.mockResolvedValue(datasetsPage([dataset]))
      setup({ upgrades: [{ canRetry: true, dataset, job: failed }] })

      await waitFor(() => expect(upgradeCards('Support knowledge')).toHaveLength(1))
      expect(
        screen.queryByRole('button', { name: 'common.operation.retry' }),
      ).not.toBeInTheDocument()
    })

    it('hides a knowledge space behind its active upgrade card', async () => {
      const running = job({ new_control_space_id: 'space-1' })
      api.spaces.mockResolvedValue(spacesPage([space('space-1', 'space-1')]))
      api.upgradeJobs.mockResolvedValue({ data: [running] })
      api.datasets.mockResolvedValue(datasetsPage([legacyDataset(running)]))
      setup()

      await waitFor(() => expect(upgradeCards('Support knowledge')).toHaveLength(1))
      expect(screen.queryByRole('link', { name: 'space-1' })).not.toBeInTheDocument()
    })

    it('dismisses a completed local upgrade only after its space is visible and the job leaves recovery', async () => {
      const succeeded = job({
        completed_documents: 10,
        new_control_space_id: 'space-1',
        stage: 'completed',
        status: 'succeeded',
      })
      const dataset = legacyDataset(succeeded)
      const { dismissUpgrade, refresh } = setup({
        upgrades: [{ canRetry: false, dataset, job: succeeded }],
      })

      expect(await screen.findByRole('link', { name: 'Support knowledge' })).toHaveAttribute(
        'href',
        '/datasets/new/space-1',
      )

      api.spaces.mockResolvedValue(spacesPage([space('space-1', 'Upgraded knowledge')]))
      api.upgradeJobs.mockResolvedValue({ data: [{ ...succeeded, status: 'running' }] })
      api.datasets.mockResolvedValue(datasetsPage([dataset]))
      await refresh(...recoveryKeys())

      expect(await screen.findByRole('link', { name: 'Upgraded knowledge' })).toBeInTheDocument()
      expect(dismissUpgrade).not.toHaveBeenCalled()

      api.upgradeJobs.mockResolvedValue({ data: [] })
      await refresh(...recoveryKeys())

      await waitFor(() => expect(dismissUpgrade).toHaveBeenCalledWith('upgrade-1'))
    })
  })
})
