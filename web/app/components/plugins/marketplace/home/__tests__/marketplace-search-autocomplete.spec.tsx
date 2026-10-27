import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { MARKETPLACE_API_PREFIX } from '@/config'
import {
  MarketplaceSearchAutocomplete,
  MarketplaceSearchForm,
} from '../marketplace-search-autocomplete'

const { mockAssign, mockPluginSearch, mockTemplateSearch } = vi.hoisted(() => ({
  mockAssign: vi.fn(),
  mockPluginSearch: vi.fn(),
  mockTemplateSearch: vi.fn(),
}))

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')

  return createReactI18nextMock({
    clearSearch: 'Clear search',
    loading: 'Loading',
    'marketplace.loadError': 'Failed to load. Please try again.',
    'marketplace.home.plugins': 'Plugins',
    'marketplace.home.templates': 'Templates',
    'marketplace.noPluginFound': 'No integration found',
    'newApp.noTemplateFound': 'No templates found',
  })
})

vi.mock('@/service/marketplace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/marketplace')>()
  return {
    ...actual,
    marketplaceQuery: {
      ...actual.marketplaceQuery,
      searchAdvanced: {
        ...actual.marketplaceQuery.searchAdvanced,
        queryOptions: (
          options: Parameters<typeof actual.marketplaceQuery.searchAdvanced.queryOptions>[0],
        ) => ({
          ...actual.marketplaceQuery.searchAdvanced.queryOptions(options),
          queryFn: () => mockPluginSearch(options.input),
        }),
      },
      templateSearch: {
        ...actual.marketplaceQuery.templateSearch,
        queryOptions: (
          options: Parameters<typeof actual.marketplaceQuery.templateSearch.queryOptions>[0],
        ) => ({
          ...actual.marketplaceQuery.templateSearch.queryOptions(options),
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

describe('MarketplaceSearchAutocomplete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAssign.mockReset()
    vi.spyOn(window.location, 'assign').mockImplementation(mockAssign)
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          gcTime: 0,
          retry: false,
        },
      },
    })
    mockPluginSearch.mockResolvedValue({ data: { plugins: [], total: 0 } })
    mockTemplateSearch.mockResolvedValue({ data: { templates: [], total: 0 } })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows template suggestions and keeps the route search form contract', async () => {
    let resolveTemplateSearch!: (value: unknown) => void
    const templateSearchPromise = new Promise((resolve) => {
      resolveTemplateSearch = resolve
    })
    mockTemplateSearch.mockReturnValue(templateSearchPromise)
    const templateSearchResponse = {
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
    }
    const user = userEvent.setup()

    const { container } = render(
      <MarketplaceSearchForm
        action="/templates/knowledge"
        category="knowledge"
        language="en-US"
        locale="en-US"
        placeholder="Search all templates..."
        query=""
        scope="templates"
      />,
      { wrapper: Wrapper },
    )

    await user.type(screen.getByRole('combobox'), 'legal')
    expect(screen.queryByText('Legal Research Agent')).not.toBeInTheDocument()
    expect(screen.getByText(/Loading/)).toBeInTheDocument()
    expect(screen.getByText(/Loading/).closest('[aria-busy="true"]')).not.toBeNull()
    resolveTemplateSearch(templateSearchResponse)

    expect(await screen.findByText('Legal Research Agent')).toBeInTheDocument()
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0)
    expect(screen.queryByText(/Loading/)).not.toBeInTheDocument()
    expect(screen.getByText('Research legal questions with cited sources.')).toBeInTheDocument()

    await user.click(screen.getByText('Legal Research Agent'))
    expect(mockAssign).toHaveBeenCalledWith('/template/dify/template-1')

    expect(container.querySelector('form')).toHaveAttribute('action', '/templates/knowledge')
    expect(Object.fromEntries(new FormData(container.querySelector('form')!))).toEqual({
      q: 'legal',
      language: 'en-US',
    })
    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(screen.getByRole('combobox')).toHaveValue('')
    expect(mockPluginSearch).not.toHaveBeenCalled()
  })

  it('shows plugin suggestions while preserving the controlled search owner', async () => {
    mockPluginSearch.mockResolvedValue({
      data: {
        plugins: [
          {
            type: 'plugin',
            org: 'langgenius',
            name: 'google-search',
            label: { en_US: 'Google Search' },
            brief: { en_US: 'Search the web from your workflow.' },
            category: 'tool',
          },
        ],
        total: 1,
      },
    })
    const user = userEvent.setup()
    const onValueChange = vi.fn()

    const ControlledSearch = () => {
      const [value, setValue] = useState('')

      return (
        <MarketplaceSearchAutocomplete
          locale="en-US"
          onValueChange={(nextValue) => {
            onValueChange(nextValue)
            setValue(nextValue)
          }}
          placeholder="Search plugins"
          scope="plugins"
          value={value}
        />
      )
    }

    render(<ControlledSearch />, { wrapper: Wrapper })

    await user.type(screen.getByRole('combobox'), 'google')

    expect(await screen.findByText('Google Search')).toBeInTheDocument()
    expect(screen.getByText('Search the web from your workflow.')).toBeInTheDocument()
    expect(screen.getByRole('listbox').querySelector('img')).toHaveAttribute(
      'src',
      `${MARKETPLACE_API_PREFIX}/plugins/langgenius/google-search/icon`,
    )
    expect(onValueChange).toHaveBeenLastCalledWith('google')
    expect(mockTemplateSearch).not.toHaveBeenCalled()
  })

  it('groups mixed suggestions and opens the selected result instead of viewing more', async () => {
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
    mockPluginSearch.mockResolvedValue({
      data: {
        plugins: [
          {
            type: 'plugin',
            org: 'langgenius',
            name: 'google-search',
            label: { en_US: 'Google Search' },
            brief: { en_US: 'Search the web from your workflow.' },
            category: 'tool',
          },
        ],
        total: 1,
      },
    })
    const user = userEvent.setup()
    const handleSubmit = vi.fn((event: Event) => {
      event.preventDefault()
    })

    const { container } = render(
      <MarketplaceSearchForm
        action="/"
        locale="en-US"
        placeholder="Search plugins or templates"
        query=""
        scope="all"
      />,
      { wrapper: Wrapper },
    )

    container.querySelector('form')?.addEventListener('submit', handleSubmit)

    await user.type(screen.getByRole('combobox'), 'search')

    const templateGroup = await screen.findByRole('group', { name: 'Templates' })
    const pluginGroup = screen.getByRole('group', { name: 'Plugins' })
    expect(within(templateGroup).getByText('Legal Research Agent')).toBeInTheDocument()
    expect(within(pluginGroup).getByText('Google Search')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /view more/i })).not.toBeInTheDocument()

    await user.click(screen.getByText('Google Search'))

    expect(mockAssign).toHaveBeenCalledWith('/plugin/langgenius/google-search')
    expect(handleSubmit).not.toHaveBeenCalled()
  })

  it('leaves Enter to the form submission when no suggestion is highlighted', async () => {
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
    mockPluginSearch.mockResolvedValue({
      data: {
        plugins: [
          {
            type: 'plugin',
            org: 'langgenius',
            name: 'google-search',
            label: { en_US: 'Google Search' },
            brief: { en_US: 'Search the web from your workflow.' },
            category: 'tool',
          },
        ],
        total: 1,
      },
    })
    const user = userEvent.setup()
    const handleSubmit = vi.fn((event: Event) => {
      event.preventDefault()
    })

    const { container } = render(
      <MarketplaceSearchForm
        action="/search/all"
        locale="en-US"
        placeholder="Search plugins or templates"
        query=""
        scope="all"
      />,
      { wrapper: Wrapper },
    )

    container.querySelector('form')?.addEventListener('submit', handleSubmit)

    await user.type(screen.getByRole('combobox'), 'search')
    await screen.findByRole('option', { name: /Legal Research Agent/ })

    // An IME confirmation keeps the suggestions open and submits nothing.
    fireEvent.keyDown(screen.getByRole('combobox'), {
      key: 'Enter',
      keyCode: 229,
      which: 229,
      isComposing: true,
    })
    expect(handleSubmit).not.toHaveBeenCalled()
    expect(screen.getByRole('option', { name: /Legal Research Agent/ })).toBeInTheDocument()

    // Nothing is highlighted, so Enter is not consumed and the browser's implicit form submission
    // runs; happy-dom has none, so the browser spec covers the submit.
    expect(fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })).toBe(true)
    expect(screen.getByRole('combobox')).toHaveValue('search')
    await waitFor(() => {
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    })
  })

  it('selects a suggestion without submitting when the parent handles the result', async () => {
    mockPluginSearch.mockResolvedValue({
      data: {
        plugins: [
          {
            type: 'plugin',
            org: 'langgenius',
            name: 'google-search',
            label: { en_US: 'Google Search' },
            brief: { en_US: 'Search the web from your workflow.' },
            category: 'tool',
          },
        ],
        total: 1,
      },
    })
    const user = userEvent.setup()
    const onSuggestionSelect = vi.fn()
    const handleSubmit = vi.fn((event: Event) => {
      event.preventDefault()
    })

    const ControlledSearch = () => {
      const [value, setValue] = useState('')

      return (
        <form>
          <MarketplaceSearchAutocomplete
            inputName="q"
            locale="en-US"
            onSuggestionSelect={onSuggestionSelect}
            onValueChange={setValue}
            placeholder="Search plugins"
            scope="plugins"
            value={value}
          />
        </form>
      )
    }

    const { container } = render(<ControlledSearch />, { wrapper: Wrapper })
    container.querySelector('form')?.addEventListener('submit', handleSubmit)

    await user.type(screen.getByRole('combobox'), 'google')
    await user.click(await screen.findByText('Google Search'))

    expect(screen.getByRole('combobox')).toHaveValue('')
    expect(mockAssign).not.toHaveBeenCalled()
    expect(onSuggestionSelect).toHaveBeenCalledOnce()
    expect(onSuggestionSelect.mock.calls[0]?.[0]).toMatchObject({
      kind: 'plugin',
      plugin: { name: 'google-search' },
    })
    expect(handleSubmit).not.toHaveBeenCalled()
  })

  it('keeps keyboard selection working for the highlighted suggestion', async () => {
    mockPluginSearch.mockResolvedValue({
      data: {
        plugins: [
          {
            type: 'plugin',
            org: 'langgenius',
            name: 'google-search',
            label: { en_US: 'Google Search' },
            brief: { en_US: 'Search the web from your workflow.' },
            category: 'tool',
          },
        ],
        total: 1,
      },
    })
    const user = userEvent.setup()
    const handleSubmit = vi.fn((event: Event) => {
      event.preventDefault()
    })

    const { container } = render(
      <MarketplaceSearchForm
        action="/plugins"
        locale="en-US"
        placeholder="Search plugins"
        query=""
        scope="plugins"
      />,
      { wrapper: Wrapper },
    )

    container.querySelector('form')?.addEventListener('submit', handleSubmit)

    await user.type(screen.getByRole('combobox'), 'google')
    expect(await screen.findByText('Google Search')).toBeInTheDocument()
    await user.keyboard('{ArrowDown}{Enter}')

    expect(mockAssign).toHaveBeenCalledWith('/plugin/langgenius/google-search')
    expect(handleSubmit).not.toHaveBeenCalled()
  })

  it('keeps the previous suggestions listed under a loading status while a new search is pending', async () => {
    const googleResponse = {
      data: {
        plugins: [
          {
            type: 'plugin',
            org: 'langgenius',
            name: 'google-search',
            label: { en_US: 'Google Search' },
            brief: { en_US: 'Search the web from your workflow.' },
            category: 'tool',
          },
        ],
        total: 1,
      },
    }
    mockPluginSearch.mockImplementation((input: { body: { query: string } }) => {
      if (input.body.query === 'google') return Promise.resolve(googleResponse)
      // Keep the follow-up term pending so the loading state stays observable.
      return new Promise(() => {})
    })
    const user = userEvent.setup()

    const ControlledSearch = () => {
      const [value, setValue] = useState('')

      return (
        <MarketplaceSearchAutocomplete
          locale="en-US"
          onValueChange={setValue}
          placeholder="Search plugins"
          scope="plugins"
          value={value}
        />
      )
    }

    render(<ControlledSearch />, { wrapper: Wrapper })

    await user.type(screen.getByRole('combobox'), 'google')
    expect(await screen.findByText('Google Search')).toBeInTheDocument()

    await user.type(screen.getByRole('combobox'), ' drive')
    expect(screen.getByText('Google Search')).toBeInTheDocument()
    expect(screen.getByText(/Loading/)).toBeInTheDocument()
    await waitFor(() =>
      expect(mockPluginSearch).toHaveBeenLastCalledWith(
        expect.objectContaining({ body: expect.objectContaining({ query: 'google drive' }) }),
      ),
    )

    expect(screen.getByText('Google Search')).toBeInTheDocument()
    expect(screen.getByText(/Loading/)).toBeInTheDocument()
    expect(screen.getByText(/Loading/).closest('[aria-busy="true"]')).not.toBeNull()
  })

  it('does not reopen after dismiss while a request is still pending', async () => {
    let resolvePluginSearch!: (value: unknown) => void
    mockPluginSearch.mockReturnValue(
      new Promise((resolve) => {
        resolvePluginSearch = resolve
      }),
    )
    const user = userEvent.setup()
    const pluginResponse = {
      data: {
        plugins: [
          {
            type: 'plugin',
            org: 'langgenius',
            name: 'google-search',
            label: { en_US: 'Google Search' },
            brief: { en_US: 'Search the web from your workflow.' },
            category: 'tool',
          },
        ],
        total: 1,
      },
    }

    const ControlledSearch = () => {
      const [value, setValue] = useState('')

      return (
        <>
          <MarketplaceSearchAutocomplete
            locale="en-US"
            onValueChange={setValue}
            placeholder="Search plugins"
            scope="plugins"
            value={value}
          />
          <button type="button">Outside search</button>
        </>
      )
    }

    render(<ControlledSearch />, { wrapper: Wrapper })

    await user.type(screen.getByRole('combobox'), 'google')
    expect(screen.getByText(/Loading/)).toBeInTheDocument()

    // Base UI hides the rest of the page from assistive technology while the suggestions are
    // open, so the outside control is reached by text rather than by role.
    await user.click(screen.getByText('Outside search'))
    await waitFor(() => {
      const loading = screen.queryByText(/Loading/)
      if (loading) expect(loading).not.toBeVisible()
    })

    await act(async () => resolvePluginSearch(pluginResponse))
    expect(screen.queryByText('Google Search')).not.toBeInTheDocument()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('announces an empty result after the search completes', async () => {
    mockPluginSearch.mockResolvedValue({ data: { plugins: [], total: 0 } })
    const user = userEvent.setup()

    const ControlledSearch = () => {
      const [value, setValue] = useState('')

      return (
        <MarketplaceSearchAutocomplete
          locale="en-US"
          onValueChange={setValue}
          placeholder="Search plugins"
          scope="plugins"
          value={value}
        />
      )
    }

    render(<ControlledSearch />, { wrapper: Wrapper })

    await user.type(screen.getByRole('combobox'), 'zzzz')

    expect(await screen.findByText('No integration found')).toBeInTheDocument()
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0)
    expect(screen.queryByText(/Loading/)).not.toBeInTheDocument()
  })
})
