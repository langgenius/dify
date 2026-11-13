import type { consoleClient } from '@/service/console'
import { page, userEvent } from 'vite-plus/test/browser'
import { createHttpError } from '@/service/http-error'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import {
  datasetsPage,
  knowledgeList,
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

describe('NewKnowledgeList collection', () => {
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
})
