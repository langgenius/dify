import type { Collection } from '@/app/components/tools/types'
/**
 * Integration Test: Tool Browsing & Filtering Flow
 *
 * Tests the integration between ProviderList, TabSliderNew, LabelFilter,
 * Input (search), and card rendering. Verifies that tab switching, keyword
 * filtering, and label filtering work together correctly.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CollectionType } from '@/app/components/tools/types'

// ---- Mocks ----

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'type.builtIn': 'Built-in',
        'type.custom': 'Custom',
        'type.workflow': 'Workflow',
        'noTools': 'No tools found',
      }
      return map[key] ?? key
    },
  }),
}))

vi.mock('nuqs', () => ({
  useQueryState: () => ['builtin', vi.fn()],
}))

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: () => ({ enable_marketplace: false }),
}))

vi.mock('@/app/components/plugins/hooks', () => ({
  useTags: () => ({
    getTagLabel: (key: string) => key,
    tags: [],
  }),
}))

vi.mock('@/service/use-plugins', () => ({
  useCheckInstalled: () => ({ data: null }),
  useInvalidateInstalledPluginList: () => vi.fn(),
}))

const mockCollections: Collection[] = [
  {
    id: 'google-search',
    name: 'google_search',
    author: 'Dify',
    description: { en_US: 'Google Search Tool', zh_Hans: 'Google搜索工具' },
    icon: 'https://example.com/google.png',
    label: { en_US: 'Google Search', zh_Hans: 'Google搜索' },
    type: CollectionType.builtIn,
    team_credentials: {},
    is_team_authorization: true,
    allow_delete: false,
    labels: ['search'],
  },
  {
    id: 'weather-api',
    name: 'weather_api',
    author: 'Dify',
    description: { en_US: 'Weather API Tool', zh_Hans: '天气API工具' },
    icon: 'https://example.com/weather.png',
    label: { en_US: 'Weather API', zh_Hans: '天气API' },
    type: CollectionType.builtIn,
    team_credentials: {},
    is_team_authorization: false,
    allow_delete: false,
    labels: ['utility'],
  },
  {
    id: 'my-custom-tool',
    name: 'my_custom_tool',
    author: 'User',
    description: { en_US: 'My Custom Tool', zh_Hans: '我的自定义工具' },
    icon: 'https://example.com/custom.png',
    label: { en_US: 'My Custom Tool', zh_Hans: '我的自定义工具' },
    type: CollectionType.custom,
    team_credentials: {},
    is_team_authorization: false,
    allow_delete: true,
    labels: [],
  },
  {
    id: 'workflow-tool-1',
    name: 'workflow_tool_1',
    author: 'User',
    description: { en_US: 'Workflow Tool', zh_Hans: '工作流工具' },
    icon: 'https://example.com/workflow.png',
    label: { en_US: 'Workflow Tool', zh_Hans: '工作流工具' },
    type: CollectionType.workflow,
    team_credentials: {},
    is_team_authorization: false,
    allow_delete: true,
    labels: [],
  },
]

const mockRefetch = vi.fn()
vi.mock('@/service/use-tools', () => ({
  useAllToolProviders: () => ({
    data: mockCollections,
    refetch: mockRefetch,
    isSuccess: true,
  }),
}))

vi.mock('@/app/components/base/tab-slider-new', () => ({
  default: ({ value, onChange, options }: { value: string, onChange: (v: string) => void, options: Array<{ value: string, text: string }> }) => (
    <div data-testid="tab-slider">
      {options.map((opt: { value: string, text: string }) => (
        <button
          key={opt.value}
          data-testid={`tab-${opt.value}`}
          data-active={value === opt.value ? 'true' : 'false'}
          onClick={() => onChange(opt.value)}
        >
          {opt.text}
        </button>
      ))}
    </div>
  ),
}))

vi.mock('@/app/components/base/input', () => ({
  default: ({ value, onChange, onClear, showLeftIcon, showClearIcon, wrapperClassName }: {
    value: string
    onChange: (e: { target: { value: string } }) => void
    onClear: () => void
    showLeftIcon?: boolean
    showClearIcon?: boolean
    wrapperClassName?: string
  }) => (
    <div data-testid="search-input-wrapper" className={wrapperClassName}>
      <input
        data-testid="search-input"
        value={value}
        onChange={onChange}
        data-left-icon={showLeftIcon ? 'true' : 'false'}
        data-clear-icon={showClearIcon ? 'true' : 'false'}
      />
      {showClearIcon && value && (
        <button data-testid="clear-search" onClick={onClear}>Clear</button>
      )}
    </div>
  ),
}))

vi.mock('@/app/components/plugins/card', () => ({
  default: ({ payload, className }: { payload: { brief: Record<string, string> | string, name: string }, className?: string }) => {
    const briefText = typeof payload.brief === 'object' ? payload.brief?.en_US || '' : payload.brief
    return (
      <div data-testid={`card-${payload.name}`} className={className}>
        <span>{payload.name}</span>
        <span>{briefText}</span>
      </div>
    )
  },
}))

vi.mock('@/app/components/plugins/card/card-more-info', () => ({
  default: ({ tags }: { tags: string[] }) => (
    <div data-testid="card-more-info">{tags.join(', ')}</div>
  ),
}))

vi.mock('@/app/components/tools/labels/filter', () => ({
  default: ({ value: _value, onChange }: { value: string[], onChange: (v: string[]) => void }) => (
    <div data-testid="label-filter">
      <button data-testid="filter-search" onClick={() => onChange(['search'])}>Filter: search</button>
      <button data-testid="filter-utility" onClick={() => onChange(['utility'])}>Filter: utility</button>
      <button data-testid="filter-clear" onClick={() => onChange([])}>Clear filter</button>
    </div>
  ),
}))

vi.mock('@/app/components/tools/provider/custom-create-card', () => ({
  default: () => <div data-testid="custom-create-card">Create Custom Tool</div>,
}))

vi.mock('@/app/components/tools/provider/detail', () => ({
  default: ({ collection, onHide }: { collection: Collection, onHide: () => void }) => (
    <div data-testid="provider-detail">
      <span data-testid="detail-name">{collection.name}</span>
      <button data-testid="detail-close" onClick={onHide}>Close</button>
    </div>
  ),
}))

vi.mock('@/app/components/tools/provider/empty', () => ({
  default: () => <div data-testid="workflow-empty">No workflow tools</div>,
}))

vi.mock('@/app/components/plugins/plugin-detail-panel', () => ({
  default: ({ detail, onHide }: { detail: unknown, onHide: () => void }) => (
    detail ? <div data-testid="plugin-detail-panel"><button onClick={onHide}>Close</button></div> : null
  ),
}))

vi.mock('@/app/components/plugins/marketplace/empty', () => ({
  default: ({ text }: { text: string }) => <div data-testid="empty-state">{text}</div>,
}))

vi.mock('@/app/components/tools/marketplace', () => ({
  default: () => null,
}))

vi.mock('@/app/components/tools/mcp', () => ({
  default: () => <div data-testid="mcp-list">MCP List</div>,
}))

vi.mock('@/utils/classnames', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}))

vi.mock('@/app/components/workflow/block-selector/types', () => ({
  ToolTypeEnum: { BuiltIn: 'builtin', Custom: 'api', Workflow: 'workflow', MCP: 'mcp' },
}))

const { default: ProviderList } = await import('@/app/components/tools/provider-list')

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('Tool Browsing & Filtering Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cleanup()
  })

  it('renders tab options and built-in tools by default', () => {
    render(<ProviderList />, { wrapper: createWrapper() })

    expect(screen.getByTestId('tab-slider')).toBeInTheDocument()
    expect(screen.getByTestId('tab-builtin')).toBeInTheDocument()
    expect(screen.getByTestId('tab-api')).toBeInTheDocument()
    expect(screen.getByTestId('tab-workflow')).toBeInTheDocument()
    expect(screen.getByTestId('tab-mcp')).toBeInTheDocument()

    expect(screen.getByTestId('card-google_search')).toBeInTheDocument()
    expect(screen.getByTestId('card-weather_api')).toBeInTheDocument()
    expect(screen.queryByTestId('card-my_custom_tool')).not.toBeInTheDocument()
    expect(screen.queryByTestId('card-workflow_tool_1')).not.toBeInTheDocument()
  })

  it('filters tools by keyword search', async () => {
    render(<ProviderList />, { wrapper: createWrapper() })

    const searchInput = screen.getByTestId('search-input')
    fireEvent.change(searchInput, { target: { value: 'Google' } })

    await waitFor(() => {
      expect(screen.getByTestId('card-google_search')).toBeInTheDocument()
      expect(screen.queryByTestId('card-weather_api')).not.toBeInTheDocument()
    })
  })

  it('clears search keyword and shows all tools again', async () => {
    render(<ProviderList />, { wrapper: createWrapper() })

    const searchInput = screen.getByTestId('search-input')
    fireEvent.change(searchInput, { target: { value: 'Google' } })
    await waitFor(() => {
      expect(screen.queryByTestId('card-weather_api')).not.toBeInTheDocument()
    })

    fireEvent.change(searchInput, { target: { value: '' } })
    await waitFor(() => {
      expect(screen.getByTestId('card-google_search')).toBeInTheDocument()
      expect(screen.getByTestId('card-weather_api')).toBeInTheDocument()
    })
  })

  it('filters tools by label tags', async () => {
    render(<ProviderList />, { wrapper: createWrapper() })

    fireEvent.click(screen.getByTestId('filter-search'))

    await waitFor(() => {
      expect(screen.getByTestId('card-google_search')).toBeInTheDocument()
      expect(screen.queryByTestId('card-weather_api')).not.toBeInTheDocument()
    })
  })

  it('clears label filter and shows all tools', async () => {
    render(<ProviderList />, { wrapper: createWrapper() })

    fireEvent.click(screen.getByTestId('filter-utility'))
    await waitFor(() => {
      expect(screen.queryByTestId('card-google_search')).not.toBeInTheDocument()
      expect(screen.getByTestId('card-weather_api')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('filter-clear'))
    await waitFor(() => {
      expect(screen.getByTestId('card-google_search')).toBeInTheDocument()
      expect(screen.getByTestId('card-weather_api')).toBeInTheDocument()
    })
  })

  it('combines keyword search and label filter', async () => {
    render(<ProviderList />, { wrapper: createWrapper() })

    fireEvent.click(screen.getByTestId('filter-search'))
    await waitFor(() => {
      expect(screen.getByTestId('card-google_search')).toBeInTheDocument()
    })

    const searchInput = screen.getByTestId('search-input')
    fireEvent.change(searchInput, { target: { value: 'Weather' } })
    await waitFor(() => {
      expect(screen.queryByTestId('card-google_search')).not.toBeInTheDocument()
      expect(screen.queryByTestId('card-weather_api')).not.toBeInTheDocument()
    })
  })

  it('opens provider detail when clicking a non-plugin collection card', async () => {
    render(<ProviderList />, { wrapper: createWrapper() })

    const card = screen.getByTestId('card-google_search')
    fireEvent.click(card.parentElement!)

    await waitFor(() => {
      expect(screen.getByTestId('provider-detail')).toBeInTheDocument()
      expect(screen.getByTestId('detail-name')).toHaveTextContent('google_search')
    })
  })

  it('closes provider detail and deselects current provider', async () => {
    render(<ProviderList />, { wrapper: createWrapper() })

    const card = screen.getByTestId('card-google_search')
    fireEvent.click(card.parentElement!)

    await waitFor(() => {
      expect(screen.getByTestId('provider-detail')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('detail-close'))
    await waitFor(() => {
      expect(screen.queryByTestId('provider-detail')).not.toBeInTheDocument()
    })
  })

  it('shows label filter for non-MCP tabs', () => {
    render(<ProviderList />, { wrapper: createWrapper() })

    expect(screen.getByTestId('label-filter')).toBeInTheDocument()
  })

  it('shows search input on all tabs', () => {
    render(<ProviderList />, { wrapper: createWrapper() })

    expect(screen.getByTestId('search-input')).toBeInTheDocument()
  })
})
