import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { MARKETPLACE_CONTAINER_ID } from '../../constants'
import HomeCatalogNavigation from '../home-catalog-navigation'
import HomeSearch from '../home-search'
import { homeCatalogPinnedAtom } from '../home-sticky-state'
import { HomeStickyStateProvider } from '../home-sticky-state-provider'
import { MarketplaceSearchAutocomplete } from '../marketplace-search-autocomplete'

const { mockTemplateSearch } = vi.hoisted(() => ({
  mockTemplateSearch: vi.fn(),
}))

vi.mock('ahooks', async (importOriginal) => {
  const original = await importOriginal<typeof import('ahooks')>()

  return {
    ...original,
    useDebounce: <T,>(value: T) => value,
  }
})

vi.mock('react-i18next', async (importOriginal) => {
  const original = await importOriginal<typeof import('react-i18next')>()
  const { createReactI18nextMock } = await import('@/test/i18n-mock')

  return {
    ...original,
    ...createReactI18nextMock({
      clearSearch: 'Clear search',
      loading: 'Loading',
      'marketplace.loadError': 'Failed to load. Please try again.',
      'marketplace.noPluginFound': 'No integration found',
      'newApp.noTemplateFound': 'No templates found',
    }),
  }
})

vi.mock('@/service/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/service/client')>()

  return {
    ...original,
    marketplaceQuery: {
      searchAdvanced: {
        queryOptions: ({ input }: { input: unknown }) => ({
          queryKey: ['marketplace', 'plugins', input],
          queryFn: () => ({ data: { plugins: [], total: 0 } }),
        }),
      },
      templateSearch: {
        queryOptions: ({ input }: { input: unknown }) => ({
          queryKey: ['marketplace', 'templates', input],
          queryFn: () => mockTemplateSearch(input),
        }),
      },
    },
  }
})

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 0,
      retry: false,
    },
  },
})

function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

function StickyTemplateSearch() {
  const [value, setValue] = useState('')

  return (
    <MarketplaceSearchAutocomplete
      locale="en-US"
      onValueChange={setValue}
      placeholder="Search templates"
      scope="templates"
      value={value}
    />
  )
}

function PinnedHeaderState() {
  const isCatalogPinned = useAtomValue(homeCatalogPinnedAtom)

  return (
    <header className="sticky top-0 z-50 flex h-12 items-center bg-background-default">
      <span>Dify Marketplace</span>
      {isCatalogPinned && (
        <div role="tablist" aria-label="Header catalog tabs">
          Plugins and templates
        </div>
      )}
    </header>
  )
}

describe('Marketplace search autocomplete layout', () => {
  beforeEach(() => {
    queryClient.clear()
    mockTemplateSearch.mockReset()
    mockTemplateSearch.mockResolvedValue({ data: { templates: [], total: 0 } })
  })

  it('keeps the pinned catalog layout stable while the results popup opens', async () => {
    await page.viewport(1280, 720)

    const screen = await render(
      <Wrapper>
        <HomeStickyStateProvider>
          <div
            id={MARKETPLACE_CONTAINER_ID}
            data-marketplace-standalone
            data-testid="marketplace-scroll-container"
            className="h-[360px] w-[1200px] overflow-y-auto"
          >
            <PinnedHeaderState />
            <div className="h-[180px]" aria-hidden />
            <HomeSearch enableSearchShortcut={false}>
              <StickyTemplateSearch />
            </HomeSearch>
            <HomeCatalogNavigation
              catalogCategories={<div role="group" aria-label="Template categories" />}
              catalogTabs={<div role="tablist" aria-label="Catalog tabs" />}
            />
            <main aria-label="Template catalog" className="h-[900px]" />
          </div>
        </HomeStickyStateProvider>
      </Wrapper>,
    )

    const scrollContainer = screen.getByTestId('marketplace-scroll-container').element()
    scrollContainer.scrollTop = 220
    scrollContainer.dispatchEvent(new Event('scroll'))
    await new Promise(requestAnimationFrame)

    const input = screen.getByRole('combobox', { name: 'Search templates' })
    await expect.element(screen.getByRole('tablist', { name: 'Header catalog tabs' })).toBeVisible()

    const catalogNavigation = screen
      .getByRole('region', { name: 'common.mainNav.marketplace' })
      .element()
    const scrollTopBefore = scrollContainer.scrollTop
    const inputTopBefore = input.element().getBoundingClientRect().top
    const navigationTopBefore = catalogNavigation.getBoundingClientRect().top

    await input.fill('open')
    await expect.element(screen.getByText('No templates found')).toBeVisible()

    expect(scrollContainer.scrollTop).toBe(scrollTopBefore)
    await expect.element(screen.getByRole('tablist', { name: 'Header catalog tabs' })).toBeVisible()
    expect(input.element().getBoundingClientRect().top).toBeCloseTo(inputTopBefore)
    expect(catalogNavigation.getBoundingClientRect().top).toBeCloseTo(navigationTopBefore)
  })
})
