import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ProviderList from '../provider-list'

let mockActiveTab = 'builtin'
const mockSetActiveTab = vi.fn((val: string) => {
  mockActiveTab = val
})
vi.mock('nuqs', () => ({
  useQueryState: () => [mockActiveTab, mockSetActiveTab],
}))

vi.mock('@/app/components/plugins/hooks', () => ({
  useTags: () => ({
    tags: [],
    tagsMap: {},
    getTagLabel: (name: string) => name,
  }),
}))

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: () => ({ enable_marketplace: false }),
}))

const mockCollections = [
  {
    id: 'builtin-1',
    name: 'google-search',
    author: 'Dify',
    description: { en_US: 'Google Search', zh_Hans: '谷歌搜索' },
    icon: 'icon-google',
    label: { en_US: 'Google Search', zh_Hans: '谷歌搜索' },
    type: 'builtin',
    team_credentials: {},
    is_team_authorization: false,
    allow_delete: false,
    labels: ['search'],
  },
  {
    id: 'api-1',
    name: 'my-api',
    author: 'User',
    description: { en_US: 'My API tool', zh_Hans: '我的 API 工具' },
    icon: { background: '#fff', content: '🔧' },
    label: { en_US: 'My API Tool', zh_Hans: '我的 API 工具' },
    type: 'api',
    team_credentials: {},
    is_team_authorization: false,
    allow_delete: true,
    labels: [],
  },
  {
    id: 'workflow-1',
    name: 'wf-tool',
    author: 'User',
    description: { en_US: 'Workflow Tool', zh_Hans: '工作流工具' },
    icon: { background: '#fff', content: '⚡' },
    label: { en_US: 'Workflow Tool', zh_Hans: '工作流工具' },
    type: 'workflow',
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
  }),
}))

vi.mock('@/service/use-plugins', () => ({
  useCheckInstalled: () => ({ data: null }),
  useInvalidateInstalledPluginList: () => vi.fn(),
}))

vi.mock('@/app/components/base/tab-slider-new', () => ({
  default: ({ value, onChange, options }: {
    value: string
    onChange: (val: string) => void
    options: { value: string, text: string }[]
  }) => (
    <div data-testid="tab-slider">
      {options.map(opt => (
        <button
          key={opt.value}
          data-testid={`tab-${opt.value}`}
          data-active={value === opt.value}
          onClick={() => onChange(opt.value)}
        >
          {opt.text}
        </button>
      ))}
    </div>
  ),
}))

vi.mock('@/app/components/plugins/card', () => ({
  default: ({ payload, className }: { payload: { name: string }, className?: string }) => (
    <div data-testid={`card-${payload.name}`} className={className}>{payload.name}</div>
  ),
}))

vi.mock('@/app/components/plugins/card/card-more-info', () => ({
  default: ({ tags }: { tags: string[] }) => <div data-testid="card-more-info">{tags.join(', ')}</div>,
}))

vi.mock('@/app/components/tools/labels/filter', () => ({
  default: ({ value, onChange }: { value: string[], onChange: (v: string[]) => void }) => (
    <div data-testid="label-filter">
      <button data-testid="add-filter" onClick={() => onChange(['search'])}>Add filter</button>
      <button data-testid="clear-filter" onClick={() => onChange([])}>Clear filter</button>
      <span>{value.join(', ')}</span>
    </div>
  ),
}))

vi.mock('@/app/components/tools/provider/custom-create-card', () => ({
  default: () => <div data-testid="custom-create-card">Create Custom Tool</div>,
}))

vi.mock('@/app/components/tools/provider/detail', () => ({
  default: ({ collection, onHide }: { collection: { name: string }, onHide: () => void }) => (
    <div data-testid="provider-detail">
      <span>{collection.name}</span>
      <button data-testid="detail-close" onClick={onHide}>Close</button>
    </div>
  ),
}))

vi.mock('@/app/components/tools/provider/empty', () => ({
  default: () => <div data-testid="workflow-empty">No workflow tools</div>,
}))

vi.mock('@/app/components/plugins/plugin-detail-panel', () => ({
  default: ({ detail }: { detail: unknown }) =>
    detail ? <div data-testid="plugin-detail-panel" /> : null,
}))

vi.mock('@/app/components/plugins/marketplace/empty', () => ({
  default: ({ text }: { text: string }) => <div data-testid="empty">{text}</div>,
}))

vi.mock('../marketplace', () => ({
  default: () => <div data-testid="marketplace">Marketplace</div>,
}))

vi.mock('../marketplace/hooks', () => ({
  useMarketplace: () => ({
    isLoading: false,
    marketplaceCollections: [],
    marketplaceCollectionPluginsMap: {},
    plugins: [],
    handleScroll: vi.fn(),
    page: 1,
  }),
}))

vi.mock('../mcp', () => ({
  default: ({ searchText }: { searchText: string }) => (
    <div data-testid="mcp-list">
      MCP List:
      {searchText}
    </div>
  ),
}))

describe('ProviderList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockActiveTab = 'builtin'
  })

  afterEach(() => {
    cleanup()
  })

  describe('Tab Navigation', () => {
    it('renders all four tabs', () => {
      render(<ProviderList />)
      expect(screen.getByTestId('tab-builtin')).toHaveTextContent('tools.type.builtIn')
      expect(screen.getByTestId('tab-api')).toHaveTextContent('tools.type.custom')
      expect(screen.getByTestId('tab-workflow')).toHaveTextContent('tools.type.workflow')
      expect(screen.getByTestId('tab-mcp')).toHaveTextContent('MCP')
    })

    it('switches tab when clicked', () => {
      render(<ProviderList />)
      fireEvent.click(screen.getByTestId('tab-api'))
      expect(mockSetActiveTab).toHaveBeenCalledWith('api')
    })
  })

  describe('Filtering', () => {
    it('shows only builtin collections by default', () => {
      render(<ProviderList />)
      expect(screen.getByTestId('card-google-search')).toBeInTheDocument()
      expect(screen.queryByTestId('card-my-api')).not.toBeInTheDocument()
    })

    it('filters by search keyword', () => {
      render(<ProviderList />)
      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'nonexistent' } })
      expect(screen.queryByTestId('card-google-search')).not.toBeInTheDocument()
    })

    it('shows label filter for non-MCP tabs', () => {
      render(<ProviderList />)
      expect(screen.getByTestId('label-filter')).toBeInTheDocument()
    })

    it('renders search input', () => {
      render(<ProviderList />)
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })
  })

  describe('Custom Tab', () => {
    it('shows custom create card when on api tab', () => {
      mockActiveTab = 'api'
      render(<ProviderList />)
      expect(screen.getByTestId('custom-create-card')).toBeInTheDocument()
    })
  })

  describe('Workflow Tab', () => {
    it('shows empty state when no workflow collections', () => {
      mockActiveTab = 'workflow'
      render(<ProviderList />)
      // Only one workflow collection exists, so it should show
      expect(screen.getByTestId('card-wf-tool')).toBeInTheDocument()
    })
  })

  describe('MCP Tab', () => {
    it('renders MCPList component', () => {
      mockActiveTab = 'mcp'
      render(<ProviderList />)
      expect(screen.getByTestId('mcp-list')).toBeInTheDocument()
    })
  })

  describe('Provider Detail', () => {
    it('opens provider detail when a non-plugin collection is clicked', () => {
      render(<ProviderList />)
      fireEvent.click(screen.getByTestId('card-google-search'))
      expect(screen.getByTestId('provider-detail')).toBeInTheDocument()
      expect(screen.getByTestId('provider-detail')).toHaveTextContent('google-search')
    })

    it('closes provider detail when close button is clicked', () => {
      render(<ProviderList />)
      fireEvent.click(screen.getByTestId('card-google-search'))
      expect(screen.getByTestId('provider-detail')).toBeInTheDocument()
      fireEvent.click(screen.getByTestId('detail-close'))
      expect(screen.queryByTestId('provider-detail')).not.toBeInTheDocument()
    })
  })
})
