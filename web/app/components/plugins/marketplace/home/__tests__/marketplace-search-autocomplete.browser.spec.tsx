import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { MARKETPLACE_CONTAINER_ID } from '../../constants'
import HomeCatalogNavigation from '../home-catalog-navigation'
import HomeSearch from '../home-search'
import { homeCatalogPinnedAtom } from '../home-sticky-state'
import { HomeStickyStateProvider } from '../home-sticky-state-provider'
import {
  MarketplaceSearchAutocomplete,
  MarketplaceSearchForm,
} from '../marketplace-search-autocomplete'

const { mockTemplateSearch } = vi.hoisted(() => ({
  mockTemplateSearch: vi.fn(),
}))

vi.mock('react-i18next', async (importOriginal) => {
  const original = await importOriginal<typeof import('react-i18next')>()
  const { createReactI18nextMock } = await import('@/test/i18n-mock')

  return {
    ...original,
    ...createReactI18nextMock({
      clearSearch: 'Clear search',
      loading: 'Loading',
      'marketplace.loadError': 'Failed to load. Please try again.',
      'marketplace.home.plugins': 'Plugins',
      'marketplace.home.templates': 'Templates',
      'marketplace.noPluginFound': 'No integration found',
      'newApp.noTemplateFound': 'No templates found',
    }),
  }
})

vi.mock('@/service/marketplace', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/service/marketplace')>()

  return {
    ...original,
    marketplaceQuery: {
      searchAdvanced: {
        queryOptions: (
          options: Parameters<typeof original.marketplaceQuery.searchAdvanced.queryOptions>[0],
        ) => ({
          ...original.marketplaceQuery.searchAdvanced.queryOptions(options),
          queryFn: () => ({ data: { plugins: [], total: 0 } }),
        }),
      },
      templateSearch: {
        queryOptions: (
          options: Parameters<typeof original.marketplaceQuery.templateSearch.queryOptions>[0],
        ) => ({
          ...original.marketplaceQuery.templateSearch.queryOptions(options),
          queryFn: () => mockTemplateSearch(options.input),
        }),
      },
    },
  }
})

let queryClient: QueryClient

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
    queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0, retry: false } } })
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
            style={{ height: 360, width: 1200, overflowY: 'auto' }}
          >
            <PinnedHeaderState />
            <div style={{ height: 180 }} aria-hidden />
            <HomeSearch enableSearchShortcut={false}>
              <StickyTemplateSearch />
            </HomeSearch>
            <HomeCatalogNavigation
              isMarketplacePlatform
              catalogCategories={<div role="group" aria-label="Template categories" />}
              catalogTabs={<div role="tablist" aria-label="Catalog tabs" />}
            />
            <main aria-label="Template catalog" style={{ height: 900 }} />
          </div>
        </HomeStickyStateProvider>
      </Wrapper>,
    )

    const container = screen.getByTestId('marketplace-scroll-container')
    await expect.element(container).toBeVisible()
    const scrollContainer = container.element()
    scrollContainer.scrollTop = 300
    scrollContainer.dispatchEvent(new Event('scroll'))
    await new Promise(requestAnimationFrame)

    const input = screen.getByRole('combobox', { name: 'Search templates' })
    await expect.element(screen.getByRole('tablist', { name: 'Header catalog tabs' })).toBeVisible()

    const catalogNavigation = screen
      .getByRole('region', { name: 'navigation.mainNav.marketplace' })
      .element()
    const scrollTopBefore = scrollContainer.scrollTop
    await expect.element(input).toBeVisible()
    const inputTopBefore = input.element().getBoundingClientRect().top
    const navigationTopBefore = catalogNavigation.getBoundingClientRect().top

    await input.fill('open')
    await expect.element(screen.getByText('No templates found')).toBeVisible()

    expect(scrollContainer.scrollTop).toBe(scrollTopBefore)
    // Base UI hides the page outside the open suggestions from assistive technology, so the
    // pinned tabs are only reachable when hidden elements are included.
    await expect
      .element(screen.getByRole('tablist', { name: 'Header catalog tabs', includeHidden: true }))
      .toBeVisible()
    expect(input.element().getBoundingClientRect().top).toBeCloseTo(inputTopBefore)
    expect(catalogNavigation.getBoundingClientRect().top).toBeCloseTo(navigationTopBefore)
  })

  // The search owns no Enter handler: the browser's implicit submission submits the route form
  // when no suggestion is highlighted. Only a real browser performs that submission.
  it('submits the route search form on Enter when no suggestion is highlighted', async () => {
    const handleSubmit = vi.fn((event: Event) => {
      event.preventDefault()
    })

    const screen = await render(
      <Wrapper>
        <MarketplaceSearchForm
          action="/search/templates"
          locale="en-US"
          placeholder="Search templates"
          query=""
          scope="templates"
        />
      </Wrapper>,
    )

    screen.container.querySelector('form')!.addEventListener('submit', handleSubmit)

    const input = screen.getByRole('combobox', { name: 'Search templates' })
    await input.fill('open')
    await expect.element(screen.getByText('No templates found')).toBeVisible()

    await userEvent.keyboard('{Enter}')

    expect(handleSubmit).toHaveBeenCalledOnce()
    await expect.element(input).toHaveValue('open')
  })
})
