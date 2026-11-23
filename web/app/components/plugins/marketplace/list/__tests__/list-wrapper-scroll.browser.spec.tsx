import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import common from '@/i18n/locales/en-US/common.json'
import plugin from '@/i18n/locales/en-US/plugin.json'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { useSearchPluginText } from '../../atoms'
import ListWrapper from '../list-wrapper'

const marketplace = vi.hoisted(() => ({
  collectionPlugins: vi.fn(),
  collections: vi.fn(),
  search: vi.fn(),
}))

vi.unmock('react-i18next')

// boundary: catalog collection/search reads stop at the external Marketplace HTTP client.
vi.mock('@/service/marketplace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/marketplace')>()
  return {
    ...actual,
    marketplaceClient: {
      ...actual.marketplaceClient,
      collectionPlugins: marketplace.collectionPlugins,
      collections: marketplace.collections,
      searchAdvanced: marketplace.search,
    },
  }
})

function SearchResultsHarness() {
  const [, setSearch] = useSearchPluginText()

  return (
    <div data-testid="marketplace-scroll-container" style={{ height: 320, overflowY: 'auto' }}>
      <button
        type="button"
        style={{ position: 'sticky', top: 0, zIndex: 1 }}
        onClick={() => {
          void setSearch('search')
        }}
      >
        Type search
      </button>
      <div aria-hidden style={{ height: 220 }} />
      <ListWrapper />
    </div>
  )
}

describe('Marketplace result scroll anchoring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    marketplace.collections.mockResolvedValue({
      data: {
        collections: Array.from({ length: 4 }, (_, index) => ({
          name: `collection-${index + 1}`,
          label: { en_US: `Collection ${index + 1}` },
          description: { en_US: `Collection ${index + 1} plugins` },
          searchable: false,
          search_params: {},
        })),
      },
    })
    marketplace.collectionPlugins.mockImplementation(
      ({ params }: { params: { collectionId: string } }) => ({
        data: {
          plugins: Array.from({ length: 5 }, (_, index) => ({
            type: 'plugin',
            org: 'langgenius',
            name: `${params.collectionId}-plugin-${index + 1}`,
            plugin_id: `langgenius/${params.collectionId}-plugin-${index + 1}`,
            latest_package_identifier: `langgenius/${params.collectionId}-plugin-${index + 1}:1.0.0@test`,
            label: { 'en-US': `${params.collectionId} plugin ${index + 1}` },
            brief: { 'en-US': 'A catalog plugin.' },
            tags: [],
            badges: null,
            category: 'tool',
            install_count: index + 1,
          })),
        },
      }),
    )
    marketplace.search.mockResolvedValue({
      data: {
        plugins: Array.from({ length: 20 }, (_, index) => ({
          type: 'plugin',
          org: 'langgenius',
          name: `search-result-${index + 1}`,
          plugin_id: `langgenius/search-result-${index + 1}`,
          latest_package_identifier: `langgenius/search-result-${index + 1}:1.0.0@test`,
          label: { 'en-US': `Search result ${index + 1}` },
          brief: { 'en-US': 'A real Marketplace search result.' },
          tags: [],
          badges: null,
          category: 'tool',
          install_count: index + 1,
        })),
        total: 20,
      },
    })
  })

  // Scroll anchoring is owned by Chromium's layout engine and cannot be
  // represented faithfully by the happy-dom unit project.
  it('does not move the page when the first search result header appears', async () => {
    await page.viewport(1280, 720)
    onTestFinished(guardUnexpectedFetch())
    const i18n = createInstance()
    await i18n.init({
      lng: 'en-US',
      keySeparator: false,
      resources: { 'en-US': { common, plugin } },
    })
    const { queryClient, wrapper: ConsoleProvider } = createConsoleQueryWrapper({
      systemFeatures: { deployment_edition: 'CLOUD' },
    })
    const { wrapper: UrlState } = createNuqsTestWrapper({ hasMemory: true })
    const screen = await render(
      <ConsoleProvider>
        <I18nextProvider i18n={i18n}>
          <UrlState>
            <SearchResultsHarness />
          </UrlState>
        </I18nextProvider>
      </ConsoleProvider>,
    )
    const container = screen.getByTestId('marketplace-scroll-container')
    await expect.element(container).toBeVisible()
    await expect
      .element(screen.getByRole('button', { name: 'collection-1 plugin 1' }))
      .toBeVisible()
    const scrollContainer = container.element()

    scrollContainer.scrollTop = 260
    await new Promise(requestAnimationFrame)
    const scrollTopBefore = scrollContainer.scrollTop

    await screen.getByRole('button', { name: 'Type search' }).click()
    await expect.element(screen.getByRole('status')).toHaveTextContent('20 results')
    await expect.element(screen.getByRole('button', { name: 'Search result 1' })).toBeVisible()
    await new Promise(requestAnimationFrame)

    expect(scrollContainer.scrollTop).toBe(scrollTopBefore)
    queryClient.clear()
  })
})
