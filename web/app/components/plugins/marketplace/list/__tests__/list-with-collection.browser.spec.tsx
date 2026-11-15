import type { MarketplaceCollection } from '@dify/contracts/marketplace'
import type { Plugin } from '@/app/components/plugins/types'
import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createMarketplacePluginFixture } from '@/test/fixtures/plugin'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import ListWithCollection from '../list-with-collection'

const createPlugin = (name: string) =>
  createMarketplacePluginFixture({ plugin_id: name, name, label: { en_US: name } })
const collections: MarketplaceCollection[] = [
  {
    name: 'featured',
    label: { en_US: 'Featured' },
    description: { en_US: 'Featured plugins' },
    rule: 'featured',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    searchable: true,
    search_params: { query: 'featured' },
  },
  {
    name: 'empty',
    label: { en_US: 'Empty' },
    description: { en_US: 'No plugins' },
    rule: 'empty',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    searchable: false,
    search_params: {},
  },
]

const pluginsMap: Record<string, Plugin[]> = {
  featured: [createPlugin('Plugin One'), createPlugin('Plugin Two')],
  empty: [],
}

async function renderCollections(
  props: React.ComponentProps<typeof ListWithCollection>,
  content?: React.ReactNode,
) {
  onTestFinished(guardUnexpectedFetch())
  const { wrapper: ConsoleProvider } = createConsoleQueryWrapper({
    systemFeatures: { deployment_edition: 'CLOUD' },
  })
  const { wrapper: UrlState, onUrlUpdate } = createNuqsTestWrapper({ hasMemory: true })
  const screen = await render(
    <ConsoleProvider>
      <UrlState>
        <section
          id="marketplace-container"
          aria-label="Marketplace collections"
          style={{ height: 400, overflowY: 'auto' }}
        >
          {content ?? <ListWithCollection {...props} />}
        </section>
      </UrlState>
    </ConsoleProvider>,
  )
  return { screen, onUrlUpdate }
}

it('omits empty collections and filters the catalog through View more', async () => {
  const { screen, onUrlUpdate } = await renderCollections({
    marketplaceCollections: collections,
    marketplaceCollectionPluginsMap: pluginsMap,
  })
  await expect
    .element(screen.getByRole('button', { name: 'Plugin One', exact: true }))
    .toBeVisible()
  await expect.element(screen.getByText('Empty', { exact: true })).not.toBeInTheDocument()
  await screen.getByRole('button', { name: 'plugin.marketplace.viewMore' }).click()
  await expect.poll(() => onUrlUpdate.mock.lastCall?.[0].searchParams.get('q')).toBe('featured')
})

it('uses the supplied collection action without changing the catalog URL', async () => {
  const props = { marketplaceCollections: collections, marketplaceCollectionPluginsMap: pluginsMap }
  function CustomCollection() {
    const [selected, setSelected] = useState('')
    return (
      <>
        <output aria-label="Selected collection">{selected}</output>
        <ListWithCollection
          {...props}
          onCollectionMoreClick={(params) => setSelected(params?.query ?? '')}
        />
      </>
    )
  }
  const { screen, onUrlUpdate } = await renderCollections(props, <CustomCollection />)
  await screen.getByRole('button', { name: 'plugin.marketplace.viewMore' }).click()
  await expect
    .element(screen.getByRole('status', { name: 'Selected collection' }))
    .toHaveTextContent('featured')
  expect(onUrlUpdate).not.toHaveBeenCalled()
})

it('keeps supplied card links natively reachable', async () => {
  const { screen } = await renderCollections({
    marketplaceCollections: collections,
    marketplaceCollectionPluginsMap: pluginsMap,
    cardRender: (plugin) => <a href={`/custom/${plugin.plugin_id}`}>{plugin.name}</a>,
  })
  const first = screen.getByRole('link', { name: 'Plugin One' })
  await expect.element(first).toHaveAttribute('href', '/custom/Plugin One')
  first.element().focus()
  await expect.element(first).toHaveFocus()
  await userEvent.tab()
  const second = screen.getByRole('link', { name: 'Plugin Two' })
  await expect.element(second).toHaveFocus()
  await expect.element(second).toHaveAttribute('href', '/custom/Plugin Two')
})

it('offers the partner application link only from the partner collection', async () => {
  const partner = {
    ...collections[0]!,
    name: 'partner-template',
    label: { en_US: 'Partners' },
    rule: 'partners',
    searchable: false,
  }
  const { screen } = await renderCollections({
    marketplaceCollections: [partner, collections[0]!],
    marketplaceCollectionPluginsMap: {
      'partner-template': [createPlugin('Partner Plugin')],
      featured: [createPlugin('Featured Plugin')],
    },
  })
  const link = screen.getByRole('link', { name: 'plugin.marketplace.becomePartner' })
  await expect
    .element(link)
    .toHaveAttribute('href', 'https://share-na2.hsforms.com/1NiS4r9lsSqGcuNBB77DeEQ40s9fk')
  await expect.element(link).toHaveAttribute('target', '_blank')
  await expect.element(link).toHaveAttribute('rel', 'noopener noreferrer')
  await expect
    .element(screen.getByRole('button', { name: 'Partner Plugin', exact: true }))
    .toBeVisible()
})

it('uses the real carousel instead of View more for a collection exceeding two rows', async () => {
  await page.viewport(1280, 900)
  const { screen } = await renderCollections({
    marketplaceCollections: [collections[0]!],
    marketplaceCollectionPluginsMap: {
      featured: Array.from({ length: 9 }, (_, i) => createPlugin(`Plugin ${i + 1}`)),
    },
  })
  await expect
    .element(screen.getByRole('button', { name: 'plugin.marketplace.viewMore' }))
    .not.toBeInTheDocument()
  await screen.getByRole('button', { name: 'plugin.marketplace.carousel.scrollNext' }).click()
  await expect.element(screen.getByRole('group', { name: '2 / 2' })).toBeVisible()
  await userEvent.tab()
  await expect.element(screen.getByRole('button', { name: 'Plugin 9', exact: true })).toHaveFocus()
})

it('loads distant collections through native scrolling and keeps them available on return', async () => {
  await page.viewport(1280, 900)
  const all = Array.from({ length: 7 }, (_, i) => ({
    ...collections[0]!,
    name: `collection-${i}`,
    label: { en_US: `Collection ${i}` },
  }))
  const map = Object.fromEntries(
    all.map((collection, i) => [
      collection.name,
      Array.from({ length: 8 }, (_, j) => createPlugin(`Collection ${i} Plugin ${j}`)),
    ]),
  )
  const { screen } = await renderCollections({
    marketplaceCollections: all,
    marketplaceCollectionPluginsMap: map,
    deferOffscreenCollections: true,
  })
  await expect
    .element(screen.getByRole('button', { name: 'Collection 0 Plugin 0', exact: true }))
    .toBeVisible()
  const distant = screen.getByRole('button', { name: 'Collection 6 Plugin 0', exact: true })
  await expect.element(distant).not.toBeInTheDocument()
  const scroll = screen.getByRole('region', { name: 'Marketplace collections' }).element()
  scroll.scrollTo({ top: scroll.scrollHeight })
  await expect.element(distant).toBeVisible()
  await expect
    .poll(() => {
      const card = distant.element().getBoundingClientRect()
      const viewport = scroll.getBoundingClientRect()
      return card.top >= viewport.top && card.bottom <= viewport.bottom
    })
    .toBe(true)
  scroll.scrollTo({ top: 0 })
  await expect
    .element(screen.getByRole('button', { name: 'Collection 0 Plugin 0', exact: true }))
    .toBeVisible()
  await expect.element(distant).toBeInTheDocument()
})

it('renders deferred collections when the browser lacks IntersectionObserver', async () => {
  // boundary: the unsupported observer capability is the fallback contract.
  vi.stubGlobal('IntersectionObserver', undefined)
  onTestFinished(() => {
    vi.unstubAllGlobals()
  })
  const second = { ...collections[0]!, name: 'second', label: { en_US: 'Second' } }
  const { screen } = await renderCollections({
    marketplaceCollections: [collections[0]!, second],
    marketplaceCollectionPluginsMap: { ...pluginsMap, second: [createPlugin('Fallback plugin')] },
    deferOffscreenCollections: true,
  })
  await expect
    .element(screen.getByRole('button', { name: 'Fallback plugin', exact: true }))
    .toBeVisible()
})
