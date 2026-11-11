import type { CreatorCreation } from '../model'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createDeferred } from '@/test/deferred'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import CreatorContent from '../creator-content'

const marketplace = vi.hoisted(() => ({
  fetchPluginPage: vi.fn(),
  fetchTemplatePage: vi.fn(),
}))

// boundary: publisher pagination stops at the external Marketplace HTTP client.
vi.mock('@/service/marketplace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/marketplace')>()
  return {
    ...actual,
    marketplaceClient: {
      ...actual.marketplaceClient,
      publisherPlugins: marketplace.fetchPluginPage,
      publisherTemplates: marketplace.fetchTemplatePage,
    },
  }
})

const createCreation = (
  id: string,
  title: string,
  updatedAt: number,
  createdAt: number,
  popularity: number,
): CreatorCreation => ({
  id,
  kind: 'plugin',
  title,
  description: `${title} description`,
  target: { type: 'plugin', pluginType: 'plugin', org: 'dify', name: id },
  icon: { type: 'emoji', value: 'P' },
  dependencyIcons: [],
  dependencyCount: 0,
  updatedAt,
  createdAt,
  popularity,
})

const creations = [
  createCreation('alpha', 'Alpha', 2, 3, 1),
  createCreation('bravo', 'Bravo', 3, 1, 2),
  createCreation('charlie', 'Charlie', 1, 2, 3),
]

async function renderContent({ withMore = false } = {}) {
  const { wrapper: UrlState, onUrlUpdate } = createNuqsTestWrapper({ hasMemory: true })
  const screen = await render(
    <UrlState>
      <CreatorContent
        creations={creations}
        locale="en-US"
        inventory={
          withMore
            ? {
                uniqueHandle: 'scarlettmao',
                pluginHasMore: true,
                templateHasMore: false,
                pluginNextPage: 2,
                templateNextPage: 2,
              }
            : undefined
        }
        getCreationAction={(creation) => ({ type: 'link', href: `/creation/${creation.id}` })}
      />
    </UrlState>,
  )
  return { screen, onUrlUpdate }
}

async function expectCardOrder(
  screen: Awaited<ReturnType<typeof renderContent>>['screen'],
  names: string[],
) {
  const cards = screen.getByRole('link')
  await expect
    .poll(() => cards.all().map((card) => card.element().getAttribute('aria-label')))
    .toEqual(names)
}

beforeEach(async () => {
  await page.viewport(1100, 800)
  vi.clearAllMocks()
})

it('sorts the real cards from the keyboard, persists the URL state, and restores menu focus', async () => {
  const { screen, onUrlUpdate } = await renderContent()
  await expectCardOrder(screen, ['Bravo', 'Alpha', 'Charlie'])

  const trigger = screen.getByRole('button', {
    name: /plugin\.marketplace\.creatorProfile\.sortBy/,
  })
  trigger.element().focus()
  await userEvent.keyboard('{Enter}')
  const popular = screen.getByRole('menuitemradio', {
    name: 'plugin.marketplace.creatorProfile.sort.popularity',
  })
  await expect.element(popular).toBeVisible()
  await popular.click()
  await expect.element(trigger).toHaveFocus()
  await expectCardOrder(screen, ['Charlie', 'Bravo', 'Alpha'])
  expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('sort_by')).toBe('popularity')

  const ascending = screen.getByRole('button', {
    name: 'plugin.marketplace.creatorProfile.sort.asc',
  })
  ascending.element().focus()
  await userEvent.keyboard('{Enter}')
  await expectCardOrder(screen, ['Alpha', 'Bravo', 'Charlie'])
  expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('sort_order')).toBe('asc')
  expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('sort_by')).toBe('popularity')
})

it('keeps one load-more request active and appends its real card before removing the control', async () => {
  const nextPage = createDeferred<{
    data: {
      plugins: Array<{
        type: 'plugin'
        org: string
        name: string
        labels: { 'en-US': string }
        brief: { 'en-US': string }
        install_count: number
        created_at: string
        updated_at: string
      }>
      total: number
    }
  }>()
  marketplace.fetchPluginPage.mockReturnValue(nextPage.promise)
  marketplace.fetchTemplatePage.mockResolvedValue({ data: { templates: [], total: 0 } })
  const { screen } = await renderContent({ withMore: true })
  const loadMore = screen.getByRole('button', {
    name: 'plugin.marketplace.creatorProfile.loadMore',
  })

  await loadMore.click()
  await expect.element(loadMore).toBeDisabled()
  await expect.element(loadMore).toHaveAttribute('aria-busy', 'true')
  expect(marketplace.fetchPluginPage).toHaveBeenCalledExactlyOnceWith({
    params: { uniqueHandle: 'scarlettmao' },
    query: { page: 2, page_size: 40, sort_by: 'version_updated_at', sort_order: 'DESC' },
  })
  nextPage.resolve({
    data: {
      plugins: [
        {
          type: 'plugin',
          org: 'dify',
          name: 'delta',
          labels: { 'en-US': 'Delta' },
          brief: { 'en-US': 'Delta plugin' },
          install_count: 4,
          created_at: '2026-01-04T00:00:00Z',
          updated_at: '2026-02-04T00:00:00Z',
        },
      ],
      total: 4,
    },
  })

  await expect.element(screen.getByRole('link', { name: 'Delta' })).toBeVisible()
  await expect.element(loadMore).not.toBeInTheDocument()
  expect(marketplace.fetchPluginPage).toHaveBeenCalledOnce()
  expect(marketplace.fetchTemplatePage).not.toHaveBeenCalled()
})
