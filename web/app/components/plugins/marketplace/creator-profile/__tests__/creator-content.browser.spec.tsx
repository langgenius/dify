import type { MarketplacePlugin, PublisherPluginsResponse } from '@dify/contracts/marketplace'
import type { CreatorCreation } from '../model'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createDeferred } from '@/test/deferred'
import { installFakeApi } from '@/test/fake-api'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import CreatorContent from '../creator-content'

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
  const fake = installFakeApi({
    marketplace: {
      publisherPlugins: () => ({ data: { plugins: [], total: 0 } }),
      publisherTemplates: () => ({ data: { templates: [], total: 0 } }),
    },
  })
  onTestFinished(fake)
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
  return { screen, onUrlUpdate, fake }
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
  const nextPage = createDeferred<PublisherPluginsResponse>()
  const { screen, fake } = await renderContent({ withMore: true })
  fake.use({ marketplace: { publisherPlugins: () => nextPage.promise } })
  const loadMore = screen.getByRole('button', {
    name: 'plugin.marketplace.creatorProfile.loadMore',
  })

  await loadMore.click()
  await expect.element(loadMore).toBeDisabled()
  await expect.element(loadMore).toHaveAttribute('aria-busy', 'true')
  await expect.poll(() => fake.marketplace.publisherPlugins.mock.calls.length).toBe(1)
  // The marketplace contract has no runtime schemas, so query values arrive as sent over HTTP.
  expect(fake.marketplace.publisherPlugins).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      params: { uniqueHandle: 'scarlettmao' },
      query: { page: '2', page_size: '40', sort_by: 'version_updated_at', sort_order: 'DESC' },
    }),
  )
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
        } as Partial<MarketplacePlugin> as MarketplacePlugin,
      ],
      total: 4,
    },
  })

  await expect.element(screen.getByRole('link', { name: 'Delta' })).toBeVisible()
  await expect.element(loadMore).not.toBeInTheDocument()
  expect(fake.marketplace.publisherPlugins).toHaveBeenCalledOnce()
  expect(fake.marketplace.publisherTemplates).not.toHaveBeenCalled()
})

it('reports a failed first page instead of an empty list and retries it', async () => {
  const fake = installFakeApi({
    marketplace: {
      publisherPlugins: () => ({
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
            } as Partial<MarketplacePlugin> as MarketplacePlugin,
          ],
          total: 1,
        },
      }),
      publisherTemplates: () => ({ data: { templates: [], total: 0 } }),
    },
  })
  onTestFinished(fake)
  const { wrapper: UrlState } = createNuqsTestWrapper({ hasMemory: true })
  const screen = await render(
    <UrlState>
      <CreatorContent
        creations={[]}
        locale="en-US"
        inventory={{
          uniqueHandle: 'scarlettmao',
          pluginHasMore: true,
          templateHasMore: false,
          pluginNextPage: 1,
          templateNextPage: 2,
          loadFailed: true,
        }}
        getCreationAction={(creation) => ({ type: 'link', href: `/creation/${creation.id}` })}
      />
    </UrlState>,
  )

  await expect
    .element(screen.getByText('plugin.marketplace.creatorProfile.loadMoreFailed'))
    .toBeVisible()
  await expect
    .element(screen.getByText('plugin.marketplace.creatorProfile.empty'))
    .not.toBeInTheDocument()

  await screen.getByRole('button', { name: 'plugin.marketplace.creatorProfile.loadMore' }).click()

  await expect.element(screen.getByRole('link', { name: 'Delta' })).toBeVisible()
  expect(fake.marketplace.publisherPlugins).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ query: expect.objectContaining({ page: '1' }) }),
  )
})
