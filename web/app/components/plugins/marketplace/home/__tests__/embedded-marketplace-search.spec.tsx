import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderWithNuqs } from '@/test/nuqs-testing'
import EmbeddedMarketplaceSearch from '../embedded-marketplace-search'

const { debounceState, mockPluginSearch, mockTemplateSearch } = vi.hoisted(() => ({
  debounceState: { useRealDebounce: false },
  mockPluginSearch: vi.fn(),
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

vi.mock('#i18n', async () => {
  const { withSelectorKey } = await import('@/test/i18n-mock')
  const translations: Record<string, string> = {
    'marketplace.home.searchPlaceholder': 'Search plugins or templates',
    'marketplace.home.plugins': 'Plugins',
    'marketplace.home.templates': 'Templates',
    'marketplace.loadError': 'Failed to load. Please try again.',
    'marketplace.noPluginFound': 'No integration found',
    'newApp.noTemplateFound': 'No templates found',
    clearSearch: 'Clear search',
    loading: 'Loading',
  }

  return {
    useLocale: () => 'en-US',
    useTranslation: () => ({
      t: withSelectorKey((key: string) => translations[key] ?? key),
    }),
  }
})

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

vi.mock('@/app/components/plugins/install-plugin/hooks/use-check-installed', () => ({
  default: () => ({ installedInfo: {} }),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('../../detail-dialog', () => ({
  default: ({ plugin }: { plugin: { name: string } }) => (
    <div role="dialog" aria-label="plugin-detail">
      {plugin.name}
    </div>
  ),
}))

vi.mock('../../templates/template-detail-dialog', () => ({
  default: ({ template }: { template: { template_name: string } }) => (
    <div role="dialog" aria-label="template-detail">
      {template.template_name}
    </div>
  ),
}))

let queryClient: QueryClient

const renderSearch = () => {
  const { onUrlUpdate } = renderWithNuqs(
    <QueryClientProvider client={queryClient}>
      <EmbeddedMarketplaceSearch />
    </QueryClientProvider>,
  )

  return { onUrlUpdate }
}

describe('EmbeddedMarketplaceSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('shows mixed plugin and template suggestions in the in-app search popup', async () => {
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
    const { onUrlUpdate } = renderSearch()

    await user.type(screen.getByRole('combobox'), 'search')

    const templateGroup = await screen.findByRole('group', { name: 'Templates' })
    const pluginGroup = screen.getByRole('group', { name: 'Plugins' })
    expect(within(templateGroup).getByText('Legal Research Agent')).toBeInTheDocument()
    expect(within(pluginGroup).getByText('Google Search')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /view more/i })).not.toBeInTheDocument()
    expect(onUrlUpdate).not.toHaveBeenCalled()
  })

  it('opens plugin and template details from the popup without filtering the catalog', async () => {
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
            plugin_id: 'langgenius/google-search',
            label: { en_US: 'Google Search' },
            brief: { en_US: 'Search the web from your workflow.' },
            category: 'tool',
          },
        ],
        total: 1,
      },
    })
    const user = userEvent.setup()
    const { onUrlUpdate } = renderSearch()

    await user.type(screen.getByRole('combobox'), 'search')
    await user.click(await screen.findByText('Google Search'))

    expect(screen.getByRole('dialog', { name: 'plugin-detail' })).toHaveTextContent('google-search')
    expect(onUrlUpdate).not.toHaveBeenCalled()

    await user.type(screen.getByRole('combobox'), 'search')
    await user.click(await screen.findByText('Legal Research Agent'))

    expect(screen.getByRole('dialog', { name: 'template-detail' })).toHaveTextContent(
      'Legal Research Agent',
    )
    expect(screen.queryByRole('dialog', { name: 'plugin-detail' })).not.toBeInTheDocument()
  })

  it('filters the current catalog when Enter is pressed instead of opening a result', async () => {
    mockPluginSearch.mockResolvedValue({
      data: {
        plugins: [
          {
            type: 'plugin',
            org: 'langgenius',
            name: 'google-search',
            plugin_id: 'langgenius/google-search',
            label: { en_US: 'Google Search' },
            brief: { en_US: 'Search the web from your workflow.' },
            category: 'tool',
          },
        ],
        total: 1,
      },
    })
    const user = userEvent.setup()
    const { onUrlUpdate } = renderSearch()

    await user.type(screen.getByRole('combobox'), 'google')
    await user.hover(await screen.findByRole('option', { name: /Google Search/ }))
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('q')).toBe('google')
    })
    expect(screen.queryByRole('dialog', { name: 'plugin-detail' })).not.toBeInTheDocument()
  })
})
