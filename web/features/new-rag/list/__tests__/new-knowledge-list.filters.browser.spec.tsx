import type { consoleClient } from '@/service/console'
import { page, userEvent } from 'vite-plus/test/browser'
import { consoleQuery } from '@/service/console'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import {
  datasetsPage,
  lastSearchParams,
  members,
  search,
  setup,
  space,
  spacesPage,
} from './new-knowledge-list-test-env'

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

const lastSpacesQuery = () => api.spaces.mock.calls.at(-1)?.[0]?.query

describe('NewKnowledgeList filters', () => {
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
})
