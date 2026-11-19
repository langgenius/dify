import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createInstance } from 'i18next'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { I18nextProvider } from 'react-i18next'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import appMessages from '@/i18n/locales/en-US/app.json'
import commonMessages from '@/i18n/locales/en-US/common.json'
import navigationMessages from '@/i18n/locales/en-US/navigation.json'
import pluginMessages from '@/i18n/locales/en-US/plugin.json'
import { MARKETPLACE_CONTAINER_ID } from '../../constants'
import HomeCatalogNavigation from '../home-catalog-navigation'
import HomeSearch from '../home-search'
import { homeCatalogPinnedAtom } from '../home-sticky-state'
import { HomeStickyStateProvider } from '../home-sticky-state-provider'
import {
  MarketplaceSearchAutocomplete,
  MarketplaceSearchForm,
} from '../marketplace-search-autocomplete'

const api = vi.hoisted(() => ({
  searchPlugins: vi.fn(),
  searchTemplates: vi.fn(),
}))

vi.unmock('react-i18next')

// boundary: autocomplete suggestions stop at the external Marketplace HTTP client.
vi.mock('@/service/marketplace', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/service/marketplace')>()
  return {
    ...original,
    marketplaceQuery: {
      ...original.marketplaceQuery,
      searchAdvanced: {
        ...original.marketplaceQuery.searchAdvanced,
        queryOptions: (
          options: Parameters<typeof original.marketplaceQuery.searchAdvanced.queryOptions>[0],
        ) => ({
          ...original.marketplaceQuery.searchAdvanced.queryOptions(options),
          queryFn: () => api.searchPlugins(options.input),
        }),
      },
      templateSearch: {
        ...original.marketplaceQuery.templateSearch,
        queryOptions: (
          options: Parameters<typeof original.marketplaceQuery.templateSearch.queryOptions>[0],
        ) => ({
          ...original.marketplaceQuery.templateSearch.queryOptions(options),
          queryFn: () => api.searchTemplates(options.input),
        }),
      },
    },
  }
})

const plugin = {
  type: 'plugin',
  org: 'langgenius',
  name: 'google-search',
  label: { en_US: 'Google Search' },
  brief: { en_US: 'Search the web from your workflow.' },
  category: 'tool',
}

const template = {
  id: 'template-1',
  template_name: 'Legal Research Agent',
  overview: 'Research legal questions with cited sources.',
  publisher_handle: 'dify',
  usage_count: 120,
  categories: ['knowledge'],
  icon: '📄',
  icon_background: '#FFFFFF',
  icon_file_key: '',
}

let queryClient: QueryClient
let i18n: ReturnType<typeof createInstance>

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    </QueryClientProvider>
  )
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

function SelectionOwner() {
  const [value, setValue] = useState('')
  const [selection, setSelection] = useState('None')
  const [submitted, setSubmitted] = useState(false)
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        setSubmitted(true)
      }}
    >
      <MarketplaceSearchAutocomplete
        inputName="q"
        locale="en-US"
        onSuggestionSelect={(result) => {
          setSelection(
            result.kind === 'plugin' ? result.plugin.name : result.template.template_name,
          )
        }}
        onValueChange={setValue}
        placeholder="Search plugins or templates"
        scope="all"
        value={value}
      />
      <output aria-label="Selected result">{selection}</output>
      <output aria-label="Form submitted">{submitted ? 'yes' : 'no'}</output>
    </form>
  )
}

describe('Marketplace search autocomplete', () => {
  beforeEach(async () => {
    await page.viewport(1280, 720)
    queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0, retry: false } } })
    i18n = createInstance()
    await i18n.init({
      lng: 'en-US',
      keySeparator: false,
      resources: {
        'en-US': {
          app: appMessages,
          common: commonMessages,
          navigation: navigationMessages,
          plugin: pluginMessages,
        },
      },
    })
    vi.clearAllMocks()
    api.searchPlugins.mockResolvedValue({ data: { plugins: [], total: 0 } })
    api.searchTemplates.mockResolvedValue({ data: { templates: [], total: 0 } })
  })

  it('keeps the pinned catalog layout stable while the results popup opens', async () => {
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
    const scrollContainer = container.element()
    scrollContainer.scrollTop = 300
    scrollContainer.dispatchEvent(new Event('scroll'))
    await new Promise(requestAnimationFrame)

    const input = screen.getByRole('combobox', { name: 'Search templates' })
    const navigation = screen.getByRole('region', { name: 'Marketplace' }).element()
    const scrollTop = scrollContainer.scrollTop
    const inputTop = input.element().getBoundingClientRect().top
    const navigationTop = navigation.getBoundingClientRect().top

    await input.fill('open')
    await expect.element(screen.getByText('No templates found')).toBeVisible()

    expect(scrollContainer.scrollTop).toBe(scrollTop)
    expect(input.element().getBoundingClientRect().top).toBeCloseTo(inputTop)
    expect(navigation.getBoundingClientRect().top).toBeCloseTo(navigationTop)
    await expect
      .element(screen.getByRole('tablist', { name: 'Header catalog tabs', includeHidden: true }))
      .toBeVisible()
  })

  it('uses native implicit submission with the route form fields when no result is highlighted', async () => {
    let submitted: Record<string, FormDataEntryValue> | undefined
    const screen = await render(
      <Wrapper>
        <MarketplaceSearchForm
          action="/search/templates"
          language="en-US"
          locale="en-US"
          placeholder="Search templates"
          query=""
          scope="templates"
        />
      </Wrapper>,
    )
    let action: string | undefined
    screen.container.addEventListener('submit', (event) => {
      event.preventDefault()
      const form = event.target
      if (!(form instanceof HTMLFormElement)) return
      action = form.action
      submitted = Object.fromEntries(new FormData(form))
    })
    const input = screen.getByRole('combobox', { name: 'Search templates' })

    await input.fill('open')
    await expect.element(screen.getByText('No templates found')).toBeVisible()
    await userEvent.keyboard('{Enter}')

    expect(action).toContain('/search/templates')
    expect(submitted).toEqual({ language: 'en-US', q: 'open' })
    await expect.element(input).toHaveValue('open')
  })

  it('groups mixed results and selects the highlighted option without submitting its owner', async () => {
    api.searchPlugins.mockResolvedValue({ data: { plugins: [plugin], total: 1 } })
    api.searchTemplates.mockResolvedValue({ data: { templates: [template], total: 1 } })
    const screen = await render(
      <Wrapper>
        <SelectionOwner />
      </Wrapper>,
    )
    const input = screen.getByRole('combobox', { name: 'Search plugins or templates' })

    await input.fill('search')
    await expect
      .element(screen.getByRole('group', { name: 'Templates' }).getByText('Legal Research Agent'))
      .toBeVisible()
    await expect
      .element(screen.getByRole('group', { name: 'Plugins' }).getByText('Google Search'))
      .toBeVisible()
    await userEvent.keyboard('{ArrowDown}')
    await expect.element(input).toHaveAttribute('aria-activedescendant')
    await userEvent.keyboard('{Enter}')

    await expect
      .element(screen.getByRole('status', { name: 'Selected result' }))
      .toHaveTextContent('Legal Research Agent')
    await expect
      .element(screen.getByRole('status', { name: 'Form submitted' }))
      .toHaveTextContent('no')
    await expect.element(input).toHaveValue('')
  })

  it('keeps prior results during refresh but does not reopen after the user dismisses them', async () => {
    let resolveRefresh!: (value: unknown) => void
    api.searchPlugins.mockImplementation((input: { body: { query: string } }) => {
      if (input.body.query === 'google')
        return Promise.resolve({ data: { plugins: [plugin], total: 1 } })
      return new Promise((resolve) => {
        resolveRefresh = resolve
      })
    })
    const screen = await render(
      <Wrapper>
        <SelectionOwner />
        <button type="button">Outside search</button>
      </Wrapper>,
    )
    const input = screen.getByRole('combobox', { name: 'Search plugins or templates' })

    await input.fill('google')
    await expect.element(screen.getByText('Google Search')).toBeVisible()
    await input.fill('google drive')
    await expect.element(screen.getByText('Google Search')).toBeVisible()
    await expect.element(screen.getByText('Loading')).toBeVisible()
    await expect.poll(() => typeof resolveRefresh).toBe('function')

    await userEvent.keyboard('{Escape}')
    await expect.element(screen.getByRole('listbox')).not.toBeInTheDocument()
    resolveRefresh({ data: { plugins: [plugin], total: 1 } })
    await expect.element(screen.getByRole('listbox')).not.toBeInTheDocument()
  })

  it('announces an empty result and clears the controlled value without querying the other scope', async () => {
    const screen = await render(
      <Wrapper>
        <MarketplaceSearchForm
          action="/plugins"
          locale="en-US"
          placeholder="Search plugins"
          query=""
          scope="plugins"
        />
      </Wrapper>,
    )
    const input = screen.getByRole('combobox', { name: 'Search plugins' })

    await input.fill('zzzz')
    await expect.element(screen.getByText('No integration found')).toBeVisible()
    await expect.element(screen.getByText('Loading')).not.toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await screen.getByRole('button', { name: 'Clear Search plugins' }).click()

    await expect.element(input).toHaveValue('')
    await expect.element(input).toHaveFocus()
    expect(api.searchTemplates).not.toHaveBeenCalled()
  })
})
