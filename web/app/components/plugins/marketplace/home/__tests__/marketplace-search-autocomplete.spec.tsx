import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { MARKETPLACE_API_PREFIX } from '@/config'
import {
  MarketplaceSearchAutocomplete,
  MarketplaceSearchForm,
} from '../marketplace-search-autocomplete'

const { debounceState, mockPluginSearch, mockPush, mockTemplateSearch } = vi.hoisted(() => ({
  // Most tests bypass the debounce for simplicity; the debounce-window test
  // flips this on to exercise the real 300ms lag.
  debounceState: { useRealDebounce: false },
  mockPluginSearch: vi.fn(),
  mockPush: vi.fn(),
  mockTemplateSearch: vi.fn(),
}))

vi.mock('ahooks', async (importOriginal) => {
  const original = await importOriginal<typeof import('ahooks')>()

  return {
    ...original,
    useDebounce: <T,>(value: T, options?: { wait?: number }) =>
      debounceState.useRealDebounce ? original.useDebounce(value, options) : value,
  }
})

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

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

vi.mock('@/service/client', () => ({
  marketplaceQuery: {
    searchAdvanced: {
      queryOptions: ({ input }: { input: unknown }) => ({
        queryKey: ['marketplace', 'plugins', input],
        queryFn: () => mockPluginSearch(input),
      }),
    },
    templateSearch: {
      queryOptions: ({ input }: { input: unknown }) => ({
        queryKey: ['marketplace', 'templates', input],
        queryFn: () => mockTemplateSearch(input),
      }),
    },
  },
}))

let queryClient: QueryClient

function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('MarketplaceSearchAutocomplete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPush.mockReset()
    debounceState.useRealDebounce = false
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
    expect(mockPush).toHaveBeenCalledWith(
      '/template/dify/Legal%20Research%20Agent?templateId=template-1',
    )

    expect(container.querySelector('form')).toHaveAttribute('action', '/templates/knowledge')
    expect(container.querySelector('input[role="combobox"]')).toHaveAttribute('name', 'q')
    expect(container.querySelector('input[role="combobox"]')).toHaveAttribute('type', 'text')
    expect(container.querySelectorAll('button[aria-label="Clear search"]')).toHaveLength(1)
    expect(container.querySelector('input[type="hidden"]')).toHaveValue('en-US')
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

    expect(mockPush).toHaveBeenCalledWith('/plugin/langgenius/google-search')
    expect(handleSubmit).not.toHaveBeenCalled()
  })

  it('submits the typed query on Enter without selecting a hovered suggestion', async () => {
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
    await user.hover(await screen.findByRole('option', { name: /Legal Research Agent/ }))
    await user.keyboard('{Enter}')

    expect(handleSubmit).toHaveBeenCalledOnce()
    expect(screen.getByRole('combobox')).toHaveValue('search')
  })

  it('opens plugin detail when a suggestion is chosen', async () => {
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
    await user.click(await screen.findByText('Google Search'))

    expect(mockPush).toHaveBeenCalledWith('/plugin/langgenius/google-search')
    expect(handleSubmit).not.toHaveBeenCalled()
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

    expect(mockPush).toHaveBeenCalledWith('/plugin/langgenius/google-search')
    expect(handleSubmit).not.toHaveBeenCalled()
  })

  it('hands the selected plugin back to a creator-profile owner without submitting', async () => {
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
        <form
          onSubmit={(event) => {
            handleSubmit(event.nativeEvent)
          }}
        >
          <MarketplaceSearchAutocomplete
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

    render(<ControlledSearch />, { wrapper: Wrapper })

    await user.type(screen.getByRole('combobox'), 'google')
    await user.click(await screen.findByText('Google Search'))

    expect(onSuggestionSelect).toHaveBeenCalledWith({
      kind: 'plugin',
      plugin: expect.objectContaining({
        org: 'langgenius',
        name: 'google-search',
      }),
    })
    expect(handleSubmit).not.toHaveBeenCalled()
    expect(screen.getByRole('combobox')).toHaveValue('')
  })

  it('does not offer the previous term suggestions while a new search is pending', async () => {
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
      // Keep the follow-up term pending so stale suggestions would be visible
      // if the query still returned placeholder data.
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

    expect(screen.queryByText('Google Search')).not.toBeInTheDocument()
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

    await user.click(screen.getByRole('button', { name: 'Outside search' }))
    await waitFor(() => {
      expect(screen.getByText(/Loading/)).not.toBeVisible()
    })

    resolvePluginSearch(pluginResponse)

    await waitFor(() => {
      expect(mockPluginSearch).toHaveBeenCalled()
    })
    expect(screen.queryByText('Google Search')).not.toBeInTheDocument()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('keeps the empty and status roots mounted when nothing matches', async () => {
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

  it('clears suggestions while the edited value is still debouncing', async () => {
    debounceState.useRealDebounce = true
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

    // Suggestions only appear once the real 300ms debounce has elapsed.
    await user.type(screen.getByRole('combobox'), 'google')
    expect(await screen.findByText('Google Search')).toBeInTheDocument()

    // For the first 300ms after editing, the debounced term still points at
    // the old query; the previous suggestions must already be gone.
    await user.type(screen.getByRole('combobox'), ' drive')

    expect(screen.queryByText('Google Search')).not.toBeInTheDocument()
    expect(screen.getByText(/Loading/)).toBeInTheDocument()
    expect(screen.getByText(/Loading/).closest('[aria-busy="true"]')).not.toBeNull()
  })
})
