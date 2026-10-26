import type { MarketplaceCollection } from '@dify/contracts/marketplace'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createMarketplacePluginFixture } from '@/test/fixtures/plugin'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import { BuiltinMarketplacePanel } from '../builtin-marketplace-panel'

const requests = vi.hoisted(() => ({
  installed: vi.fn(),
  search: vi.fn(),
  collections: vi.fn(),
  collectionPlugins: vi.fn(),
}))
vi.mock('@/next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.plugin.permission.fetch.get': () => ({
        install_permission: 'everyone',
        debug_permission: 'everyone',
      }),
    }),
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.plugin.installedIds.get': requests.installed,
      'workspaces.current.plugin.list.installations.ids.post': () => ({ plugins: [] }),
    }),
  }
})
vi.mock('@/service/marketplace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/marketplace')>()
  return {
    ...actual,
    marketplaceClient: {
      ...actual.marketplaceClient,
      collections: requests.collections,
      collectionPlugins: requests.collectionPlugins,
    },
  }
})
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  postMarketplace: requests.search,
}))

const render = createNuqsTestRenderer(renderWithConsoleQuery)
const plugin = createMarketplacePluginFixture({ label: { en_US: 'Weather Tool' }, tags: [] })
const collection: MarketplaceCollection = {
  name: 'featured',
  label: { en_US: 'Featured tools' },
  description: { en_US: 'Recommended tools' },
  rule: '',
  created_at: '',
  updated_at: '',
  searchable: false,
  search_params: {},
}
let enterViewport: () => void
let observedTarget: Element

beforeEach(() => {
  requests.installed.mockReset().mockResolvedValue({ plugin_ids: [] })
  requests.search.mockReset().mockResolvedValue({ data: { plugins: [plugin], total: 1 } })
  requests.collections.mockReset().mockResolvedValue({ data: { collections: [collection] } })
  requests.collectionPlugins
    .mockReset()
    .mockResolvedValue({ data: { plugins: [plugin], total: 1 } })
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        enterViewport = () =>
          callback(
            [{ isIntersecting: true, target: observedTarget } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
          )
      }
      observe(target: Element) {
        observedTarget = target
      }
      unobserve() {}
      disconnect() {}
    },
  )
})
afterEach(() => vi.unstubAllGlobals())

function renderPanel(keywords = '', tagFilterValue: string[] = []) {
  const containerRef = createRef<HTMLDivElement>()
  render(
    <div ref={containerRef}>
      <BuiltinMarketplacePanel
        containerRef={containerRef}
        contentInset="default"
        keywords={keywords}
        tagFilterValue={tagFilterValue}
      />
    </div>,
    { workspacePermissionKeys: [], systemFeatures: { rbac_enabled: true } },
  )
  return containerRef
}

it('defers catalog requests until the section enters the viewport, then shows its tools', async () => {
  renderPanel()
  expect(requests.installed).not.toHaveBeenCalled()
  expect(requests.collections).not.toHaveBeenCalled()
  expect(screen.queryByText('Weather Tool')).not.toBeInTheDocument()

  act(() => enterViewport())

  expect(await screen.findByText('Weather Tool')).toBeInTheDocument()
  expect(screen.getByText('Featured tools')).toBeInTheDocument()
})

it.each([
  { keywords: 'weather', tags: [] },
  { keywords: '', tags: ['search'] },
])(
  'loads matching tools immediately for search=$keywords and tags=$tags',
  async ({ keywords, tags }) => {
    renderPanel(keywords, tags)

    expect(await screen.findByText('Weather Tool')).toBeInTheDocument()
    expect(requests.search).toHaveBeenCalledWith(
      '/plugins/search/advanced',
      expect.objectContaining({
        body: expect.objectContaining({ query: keywords, tags, category: 'tool' }),
      }),
    )
    expect(requests.collections).not.toHaveBeenCalled()
  },
)

it('activates and scrolls to the marketplace from the real arrow action', async () => {
  const user = userEvent.setup()
  const containerRef = renderPanel()
  const scrollTo = vi.fn()
  containerRef.current!.scrollTo = scrollTo
  // Supply the browser layout at the observer boundary, rather than relying on
  // happy-dom's zero-sized layout producing a negative scroll destination.
  Object.defineProperty(observedTarget, 'offsetTop', { configurable: true, value: 500 })

  await user.click(screen.getByRole('button', { name: 'plugin.marketplace.moreFrom' }))

  expect(await screen.findByText('Weather Tool')).toBeInTheDocument()
  expect(scrollTo).toHaveBeenCalledWith({ top: 420, behavior: 'smooth' })
})
