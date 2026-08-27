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
              isMarketplacePlatform
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

  it('uses the specified panel, list, and item spacing without a bottom strip', async () => {
    await page.viewport(1280, 720)
    mockTemplateSearch.mockResolvedValue({
      data: {
        templates: [
          {
            id: 'template-1',
            template_name: 'Legal Research Agent',
            overview: 'Research legal questions with cited sources.',
            publisher_handle: 'dify',
            usage_count: 120,
            categories: ['knowledge'],
            icon: '📄',
            icon_background: '#FFFFFF',
            icon_file_key: '',
          },
          {
            id: 'template-2',
            template_name: 'Contract Reviewer',
            overview: 'Review contracts and identify risks.',
            publisher_handle: 'dify',
            usage_count: 80,
            categories: ['knowledge'],
            icon: '📄',
            icon_background: '#FFFFFF',
            icon_file_key: '',
          },
        ],
        total: 2,
      },
    })

    const screen = await render(
      <Wrapper>
        <div className="w-[420px]">
          <StickyTemplateSearch />
        </div>
      </Wrapper>,
    )

    await screen.getByRole('combobox', { name: 'Search templates' }).fill('legal')
    await expect.element(screen.getByText('Legal Research Agent')).toBeVisible()

    const list = screen.getByRole('listbox').element()
    const panel = list.parentElement!
    const firstItem = screen.getByRole('option', { name: /Legal Research Agent/ }).element()
    const lastItem = screen.getByRole('option', { name: /Contract Reviewer/ }).element()
    const panelStyle = getComputedStyle(panel)
    const listStyle = getComputedStyle(list)
    const firstItemStyle = getComputedStyle(firstItem)
    const statusRoots = screen.getByRole('status').all()
    const trailingStatus = statusRoots.at(-1)!.element()

    expect(panelStyle.paddingTop).toBe('8px')
    expect(panelStyle.paddingRight).toBe('8px')
    expect(panelStyle.paddingBottom).toBe('8px')
    expect(panelStyle.paddingLeft).toBe('8px')
    expect(listStyle.rowGap).toBe('4px')
    expect(listStyle.paddingTop).toBe('0px')
    expect(firstItemStyle.paddingTop).toBe('12px')
    expect(firstItemStyle.paddingRight).toBe('12px')
    expect(firstItemStyle.paddingBottom).toBe('12px')
    expect(firstItemStyle.paddingLeft).toBe('12px')
    expect(firstItemStyle.borderRadius).toBe('12px')
    expect(firstItemStyle.marginLeft).toBe('0px')
    expect(firstItemStyle.marginRight).toBe('0px')
    expect(trailingStatus.getBoundingClientRect().height).toBe(0)
    expect(firstItem.getBoundingClientRect().top - panel.getBoundingClientRect().top).toBeCloseTo(9)
    expect(
      panel.getBoundingClientRect().bottom - lastItem.getBoundingClientRect().bottom,
    ).toBeCloseTo(9)
  })

  it('keeps result rows fully clickable without a persistent trailing arrow', async () => {
    await page.viewport(390, 844)
    mockTemplateSearch.mockResolvedValue({
      data: {
        templates: [
          {
            id: 'template-1',
            template_name: 'Legal Research Agent',
            overview: 'Research legal questions with cited sources.',
            publisher_handle: 'dify',
            usage_count: 120,
            categories: ['knowledge'],
            icon: '📄',
            icon_background: '#FFFFFF',
            icon_file_key: '',
          },
        ],
        total: 1,
      },
    })

    const screen = await render(
      <Wrapper>
        <div className="w-full px-4">
          <StickyTemplateSearch />
        </div>
      </Wrapper>,
    )

    await screen.getByRole('combobox', { name: 'Search templates' }).fill('legal')
    const result = screen.getByRole('option', { name: /Legal Research Agent/ })
    await expect.element(result).toBeVisible()

    const resultElement = result.element()
    const resultRect = resultElement.getBoundingClientRect()
    const label = screen.getByText('Legal Research Agent').element()
    const labelRectBeforeHover = label.getBoundingClientRect()
    const trailingVisuals = Array.from(
      resultElement.querySelectorAll<HTMLElement>('[aria-hidden="true"]'),
    ).filter((element) => {
      const rect = element.getBoundingClientRect()
      return rect.width > 0 && rect.left >= resultRect.right - 40
    })

    expect(trailingVisuals).toHaveLength(0)
    expect(getComputedStyle(resultElement).cursor).toBe('pointer')

    const backgroundBeforeHover = getComputedStyle(resultElement).backgroundColor
    await result.hover()
    const labelRectAfterHover = label.getBoundingClientRect()

    expect(getComputedStyle(resultElement).backgroundColor).not.toBe(backgroundBeforeHover)
    expect(labelRectAfterHover.left).toBeCloseTo(labelRectBeforeHover.left)
    expect(labelRectAfterHover.width).toBeCloseTo(labelRectBeforeHover.width)
  })
})
