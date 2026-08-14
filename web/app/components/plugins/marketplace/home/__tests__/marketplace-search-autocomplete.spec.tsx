import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MarketplaceSearchAutocomplete,
  MarketplaceSearchForm,
} from '../marketplace-search-autocomplete'

const { mockPluginSearch, mockTemplateSearch } = vi.hoisted(() => ({
  mockPluginSearch: vi.fn(),
  mockTemplateSearch: vi.fn(),
}))

vi.mock('ahooks', async (importOriginal) => {
  const original = await importOriginal<typeof import('ahooks')>()

  return {
    ...original,
    useDebounce: <T,>(value: T) => value,
  }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'gotoAnything.searching': 'Searching...',
        'marketplace.noPluginFound': 'No integration found',
        'newApp.noTemplateFound': 'No templates found',
      })[key] ?? key,
  }),
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
    resolveTemplateSearch(templateSearchResponse)

    expect(await screen.findByText('Legal Research Agent')).toBeInTheDocument()
    expect(screen.getByText('Research legal questions with cited sources.')).toBeInTheDocument()
    expect(container.querySelector('form')).toHaveAttribute('action', '/templates/knowledge')
    expect(container.querySelector('input[role="combobox"]')).toHaveAttribute('name', 'q')
    expect(container.querySelector('input[role="combobox"]')).toHaveAttribute('type', 'text')
    expect(container.querySelectorAll('button[aria-label="clearSearch"]')).toHaveLength(1)
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
    expect(onValueChange).toHaveBeenLastCalledWith('google')
    expect(mockTemplateSearch).not.toHaveBeenCalled()
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
    expect(screen.getByRole('status')).toHaveTextContent('Searching...')
  })
})
