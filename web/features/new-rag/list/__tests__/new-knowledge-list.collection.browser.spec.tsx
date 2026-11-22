import { page, userEvent } from 'vite-plus/test/browser'
import { apiError, pendingResponse, setupFakeApi } from '@/test/fake-api'
import {
  datasetsPage,
  knowledgeList,
  members,
  search,
  setup,
  space,
  spacesPage,
} from './new-knowledge-list-test-env'

const fake = setupFakeApi(() => ({
  console: {
    knowledgeFs: {
      spaces: {
        get: async () => spacesPage(),
        byControlSpaceId: { delete: async () => {} },
      },
    },
    workspaces: { current: { members: { get: async () => ({ accounts: members }) } } },
    datasets: {
      get: async () => datasetsPage([]),
      knowledgeFsUpgradeJobs: {
        get: async () => ({ data: [] }),
      },
      byDatasetId: {
        knowledgeFsUpgrades: {
          byJobId: { get: () => pendingResponse() },
        },
      },
      apiBaseInfo: { get: () => ({ api_base_url: 'https://api.example.com' }) },
      externalKnowledgeApi: {
        get: () => ({ data: [], has_more: false, limit: 100, page: 1, total: 0 }),
      },
    },
    tags: {
      get: () => [
        { binding_count: '1', id: 'tag-1', name: 'Customer support', type: 'knowledge' },
        { binding_count: '1', id: 'tag-2', name: 'Public docs', type: 'knowledge' },
      ],
    },
  },
}))

const lastSpacesQuery = () => fake.console.knowledgeFs.spaces.get.mock.calls.at(-1)?.[0]?.query

describe('NewKnowledgeList collection', () => {
  beforeEach(async () => {
    await page.viewport(1000, 760)
  })

  describe('collection', () => {
    it('shows a loading state until the first page resolves', async () => {
      fake.console.knowledgeFs.spaces.get.mockReturnValue(pendingResponse())
      await setup()

      await expect.element(page.getByRole('status', { name: 'common.loading' })).toBeInTheDocument()
    })

    it('links each knowledge space card to its detail shell with summary details', async () => {
      fake.console.knowledgeFs.spaces.get.mockResolvedValue(
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
      expect(fake.console.knowledgeFs.spaces.get).toHaveBeenCalledWith({
        query: { limit: 30, page: 1 },
      })
    })

    it('loads the next server page while search is active', async () => {
      const user = userEvent
      fake.console.knowledgeFs.spaces.get.mockImplementation(async (input) =>
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
      fake.console.knowledgeFs.spaces.get
        .mockResolvedValueOnce(
          spacesPage([space('space-1', 'Support knowledge')], { hasMore: true }),
        )
        .mockRejectedValueOnce(
          apiError({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'request failed' }),
        )
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
        fake.console.knowledgeFs.spaces.get.mockRejectedValue(
          apiError({ status, code: 'UNAVAILABLE', message: 'Unavailable' }),
        )
        await setup()

        await expect.element(page.getByText('knowledgeSpace.unavailableTitle')).toBeInTheDocument()
        await expect
          .element(page.getByRole('button', { name: 'common.operation.retry' }))
          .not.toBeInTheDocument()
      },
    )

    it('retries other collection failures', async () => {
      const user = userEvent
      fake.console.knowledgeFs.spaces.get
        .mockRejectedValueOnce(
          apiError({ status: 500, code: 'INTERNAL_SERVER_ERROR', message: 'request failed' }),
        )
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
